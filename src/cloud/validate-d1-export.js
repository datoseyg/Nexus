import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsSuspiciousPii } from "./sanitize-d1-export.js";

// Gate de seguridad previo a subir cloud/d1/seeds/*.sql a una D1 real con
// `wrangler d1 execute` - ver docs/CLOUDFLARE_D1_MIGRATION.md. Solo LEE
// cloud/d1/schema.sql + cloud/d1/seeds/ + data/reports/cloud_d1_export_summary.json
// (generado por `npm run cloud:d1:export`) y escribe su propio resumen. No
// modifica nada.

const SCHEMA_FILE = path.join("cloud", "d1", "schema.sql");
const SEEDS_DIR = path.join("cloud", "d1", "seeds");
const EXPORT_SUMMARY_FILE = path.join("data", "reports", "cloud_d1_export_summary.json");
const VALIDATION_SUMMARY_FILE = path.join("data", "reports", "cloud_d1_export_validation.json");

// RUT chileno sin enmascarar: 7-8 dígitos + guión + dígito verificador o
// "K" (ej. "12345678-9"). Si esto aparece en un seed, maskClientRut() no
// hizo su trabajo - es un bloqueante duro.
const UNMASKED_RUT_REGEX = /\b\d{7,8}-[0-9kK]\b/;

const MAX_SEED_FILE_BYTES_WARN = 5_000_000; // 5MB
const MAX_SEED_FILE_BYTES_FAIL = 50_000_000; // 50MB

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function extractSchemaTables() {
  const raw = await fs.readFile(SCHEMA_FILE, "utf8");
  const matches = [...raw.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)];
  return matches.map(m => m[1]);
}

async function readExportSummary() {
  if (!(await pathExists(EXPORT_SUMMARY_FILE))) return null;
  try {
    return JSON.parse(await fs.readFile(EXPORT_SUMMARY_FILE, "utf8"));
  } catch {
    return null;
  }
}

export async function validateD1Export() {
  console.log("=== Validando export Cloudflare D1 ===");

  const blockers = [];
  const warnings = [];

  const schemaTables = await extractSchemaTables();
  const exportSummary = await readExportSummary();

  if (!exportSummary) {
    blockers.push(`No existe ${EXPORT_SUMMARY_FILE} - corré "npm run cloud:d1:export" primero.`);
  }

  const seedFileByTable = new Map();
  if (exportSummary) {
    for (const entry of exportSummary.tables) seedFileByTable.set(entry.d1Table, entry);
  }

  const perTableChecks = [];
  let totalRowsExported = 0;

  for (const d1Table of schemaTables) {
    const exportEntry = seedFileByTable.get(d1Table);
    if (!exportEntry) {
      blockers.push(`Tabla "${d1Table}" está en schema.sql pero no tiene seed exportado.`);
      perTableChecks.push({ d1Table, status: "MISSING_SEED" });
      continue;
    }

    const seedPath = path.join(SEEDS_DIR, exportEntry.fileName);
    if (!(await pathExists(seedPath))) {
      blockers.push(`Falta el archivo de seed ${seedPath} para la tabla "${d1Table}".`);
      perTableChecks.push({ d1Table, status: "SEED_FILE_NOT_FOUND" });
      continue;
    }

    const stat = await fs.stat(seedPath);
    const content = await fs.readFile(seedPath, "utf8");

    const check = {
      d1Table,
      seedFile: exportEntry.fileName,
      rows: exportEntry.rows,
      sizeBytes: stat.size,
      skipped: !!exportEntry.skipped,
      status: "OK"
    };

    if (containsSuspiciousPii(content)) {
      blockers.push(`Posible PII sin sanitizar en ${exportEntry.fileName}.`);
      check.status = "PII_SUSPECTED";
    }
    if (UNMASKED_RUT_REGEX.test(content)) {
      blockers.push(`Posible RUT sin enmascarar en ${exportEntry.fileName} (maskClientRut no aplicó o hay otra columna con RUT crudo).`);
      check.status = "UNMASKED_RUT_SUSPECTED";
    }
    if (stat.size > MAX_SEED_FILE_BYTES_FAIL) {
      blockers.push(`${exportEntry.fileName} excede el tamaño máximo (${MAX_SEED_FILE_BYTES_FAIL} bytes).`);
      check.status = "OVERSIZED";
    } else if (stat.size > MAX_SEED_FILE_BYTES_WARN) {
      warnings.push(`${exportEntry.fileName} es grande (${stat.size} bytes) - revisar antes de subir con wrangler.`);
    }

    if (exportEntry.skipped) {
      warnings.push(`Tabla "${d1Table}" quedó vacía: ${exportEntry.skippedReason || "sin datos reales todavía."}`);
    }

    totalRowsExported += exportEntry.rows;
    perTableChecks.push(check);
  }

  let status = "READY";
  if (warnings.length > 0) status = "READY_WITH_WARNINGS";
  if (blockers.length > 0) status = "NOT_READY";

  const summary = {
    generated_at: new Date().toISOString(),
    status,
    total_tables_in_schema: schemaTables.length,
    total_rows_exported: totalRowsExported,
    blockers,
    warnings,
    tables: perTableChecks
  };

  await fs.mkdir(path.dirname(VALIDATION_SUMMARY_FILE), { recursive: true });
  await fs.writeFile(VALIDATION_SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Estado: ${status}`);
  if (blockers.length > 0) console.log(`Bloqueantes:\n - ${blockers.join("\n - ")}`);
  if (warnings.length > 0) console.log(`Advertencias:\n - ${warnings.join("\n - ")}`);
  console.log(`Resumen guardado en ${VALIDATION_SUMMARY_FILE}`);
  console.log(`=== Validación export D1: ${status} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  validateD1Export().catch(error => {
    console.error("ERROR VALIDANDO EXPORT D1:");
    console.error(error);
    process.exit(1);
  });
}
