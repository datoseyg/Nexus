import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsSuspiciousPii } from "./sanitize-cloud-export.js";

// Gate de seguridad previo a `npm run app:build:static` / deploy a
// Cloudflare Pages - ver docs/CLOUD_SMOKE_TEST.md. Solo LEE
// apps/nexus-bi-app/public/ y escribe su propio resumen en
// data/reports/cloud_preflight_summary.json. No borra ni modifica nada.

const PUBLIC_DIR = path.join("apps", "nexus-bi-app", "public");
const CLOUD_DATA_DIR = path.join(PUBLIC_DIR, "data", "cloud");
const SUMMARY_FILE = path.join("data", "reports", "cloud_preflight_summary.json");

const REQUIRED_FILES = [
  "metadata.json",
  "dashboard-operacional-summary.json",
  "dashboard-operacional-parts.json",
  "audit-summary.json",
  "audit-manual-review.sample.json",
  "after-hours-summary.json",
  "scope-warnings.json"
];

// Solo se exporta si gold.equipment_part_lifecycle_summary existe en el
// warehouse (ver export-cloud-snapshot.js) - su ausencia no es un error.
const OPTIONAL_FILES = ["equipment-lifecycle-summary.json"];

const MAX_FILE_BYTES_WARN = 2_000_000; // 2MB
const MAX_FILE_BYTES_FAIL = 10_000_000; // 10MB

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

async function checkForbiddenContent() {
  const violations = [];
  const allFiles = await walk(PUBLIC_DIR);

  for (const file of allFiles) {
    const rel = toPosix(file);
    const base = path.basename(rel);

    if (base === ".env" || base.startsWith(".env.")) {
      violations.push({ file: rel, reason: "Archivo .env dentro de public/ - nunca debe publicarse." });
    }
    if (rel.includes("/raw/") || rel.includes("/data/raw/")) {
      violations.push({ file: rel, reason: "Ruta data/raw/ copiada dentro de public/." });
    }
    if (path.extname(rel) === ".duckdb" || rel.endsWith(".duckdb.wal")) {
      violations.push({ file: rel, reason: "Archivo del warehouse DuckDB dentro de public/." });
    }
  }

  return { violations, filesScanned: allFiles.length };
}

async function checkExpectedJsonFiles() {
  const missingRequired = [];
  const missingOptional = [];
  const present = [];

  for (const fileName of REQUIRED_FILES) {
    const exists = await pathExists(path.join(CLOUD_DATA_DIR, fileName));
    if (exists) present.push(fileName);
    else missingRequired.push(fileName);
  }

  for (const fileName of OPTIONAL_FILES) {
    const exists = await pathExists(path.join(CLOUD_DATA_DIR, fileName));
    if (exists) present.push(fileName);
    else missingOptional.push(fileName);
  }

  return { present, missingRequired, missingOptional };
}

async function checkMetadata() {
  const metadataPath = path.join(CLOUD_DATA_DIR, "metadata.json");
  if (!(await pathExists(metadataPath))) {
    return { ok: false, reason: "metadata.json no existe." };
  }

  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.dataMode !== "static") {
      return { ok: false, reason: `metadata.json tiene dataMode="${parsed.dataMode}", se esperaba "static".` };
    }
    if (!parsed.generatedAt) {
      return { ok: false, reason: "metadata.json no tiene generatedAt." };
    }
    return { ok: true, generatedAt: parsed.generatedAt, sourceWarehouse: parsed.sourceWarehouse };
  } catch (error) {
    return { ok: false, reason: `metadata.json no es JSON válido: ${error.message}` };
  }
}

async function checkPiiAndSize(presentFiles) {
  const piiHits = [];
  const oversizedWarn = [];
  const oversizedFail = [];

  for (const fileName of presentFiles) {
    const filePath = path.join(CLOUD_DATA_DIR, fileName);
    const stat = await fs.stat(filePath);

    if (stat.size > MAX_FILE_BYTES_FAIL) oversizedFail.push({ file: fileName, sizeBytes: stat.size });
    else if (stat.size > MAX_FILE_BYTES_WARN) oversizedWarn.push({ file: fileName, sizeBytes: stat.size });

    const content = await fs.readFile(filePath, "utf8");
    if (containsSuspiciousPii(content)) {
      piiHits.push(fileName);
    }
  }

  return { piiHits, oversizedWarn, oversizedFail };
}

export async function runCloudPreflight() {
  console.log("=== Preflight cloud-demo (Cloudflare Pages) ===");

  const forbidden = await checkForbiddenContent();
  const jsonFiles = await checkExpectedJsonFiles();
  const metadata = await checkMetadata();
  const piiAndSize = await checkPiiAndSize(jsonFiles.present);

  const blockers = [];
  const warnings = [];

  if (forbidden.violations.length > 0) blockers.push(...forbidden.violations.map(v => `${v.file}: ${v.reason}`));
  if (jsonFiles.missingRequired.length > 0) blockers.push(`Faltan JSON requeridos: ${jsonFiles.missingRequired.join(", ")}`);
  if (!metadata.ok) blockers.push(`metadata.json inválido: ${metadata.reason}`);
  if (piiAndSize.piiHits.length > 0) blockers.push(`Posible PII sin sanitizar en: ${piiAndSize.piiHits.join(", ")}`);
  if (piiAndSize.oversizedFail.length > 0) {
    blockers.push(`Archivos excesivamente grandes (>${MAX_FILE_BYTES_FAIL} bytes): ${piiAndSize.oversizedFail.map(f => f.file).join(", ")}`);
  }

  if (piiAndSize.oversizedWarn.length > 0) {
    warnings.push(`Archivos grandes (>${MAX_FILE_BYTES_WARN} bytes) - revisar si es necesario: ${piiAndSize.oversizedWarn.map(f => f.file).join(", ")}`);
  }
  if (jsonFiles.missingOptional.length > 0) {
    warnings.push(`JSON opcionales no presentes (esperado si la tabla GOLD correspondiente no existe): ${jsonFiles.missingOptional.join(", ")}`);
  }

  let status = "READY";
  if (warnings.length > 0) status = "READY_WITH_WARNINGS";
  if (blockers.length > 0) status = "NOT_READY";

  const summary = {
    generated_at: new Date().toISOString(),
    status,
    blockers,
    warnings,
    checks: {
      public_dir_scanned: toPosix(PUBLIC_DIR),
      files_scanned: forbidden.filesScanned,
      forbidden_content_violations: forbidden.violations,
      expected_json: jsonFiles,
      metadata,
      pii_scan_hits: piiAndSize.piiHits,
      oversized_warn: piiAndSize.oversizedWarn,
      oversized_fail: piiAndSize.oversizedFail
    }
  };

  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Estado: ${status}`);
  if (blockers.length > 0) console.log(`Bloqueantes:\n - ${blockers.join("\n - ")}`);
  if (warnings.length > 0) console.log(`Advertencias:\n - ${warnings.join("\n - ")}`);
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`=== Preflight cloud-demo: ${status} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCloudPreflight().catch(error => {
    console.error("ERROR EN PREFLIGHT CLOUD-DEMO:");
    console.error(error);
    process.exit(1);
  });
}
