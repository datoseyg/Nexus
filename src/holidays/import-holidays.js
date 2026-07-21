import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readBundleRaw } from "./bundle-source.js";
import { validateBundle } from "./bundle-validator.js";
import { buildDryRunReport, writeDryRunReport } from "./dry-run-report.js";
import { parseArgs, validateArgs } from "./cli.js";
import { assertWriteConfirmed } from "../lib/db-safety.js";

/**
 * Peek de solo lectura, best-effort -nunca aborta el dry-run si falla
 * (mismo patrón que src/contracts/import-contracts.js).
 */
async function tryConnectedPeek() {
  try {
    const { createPool } = await import("./db-client.js");
    const pool = createPool();
    await pool.query("SELECT 1");
    return { pool, available: true };
  } catch {
    return { pool: null, available: false };
  }
}

async function loadAndValidate(filePath) {
  const { raw, sha256, parsed } = await readBundleRaw(filePath);
  void raw;
  const validation = validateBundle(parsed);
  return { bundle: parsed, sha256, validation };
}

async function runValidate(args) {
  const { bundle, sha256, validation } = await loadAndValidate(args.file);
  console.log(`Bundle: ${args.file} (sha256=${sha256.slice(0, 12)}…)`);
  console.log(`Jurisdicción: ${bundle?.jurisdiction ?? "?"}, eventos: ${validation.resolvedEvents.length}`);
  if (validation.warnings.length > 0) {
    console.warn(`Advertencias (${validation.warnings.length}):`);
    for (const w of validation.warnings) console.warn(`  - ${w}`);
  }
  if (!validation.ok) {
    console.error(`INVÁLIDO -${validation.errors.length} error(es):`);
    for (const e of validation.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log("VÁLIDO.");
}

async function runDryRun(args) {
  const { bundle, sha256, validation } = await loadAndValidate(args.file);

  const { pool, available: dbPeekAvailable } = await tryConnectedPeek();
  let alreadyImported = { isDuplicate: "unknown", priorImportId: null };
  if (dbPeekAvailable) {
    try {
      const { checkAlreadyImported } = await import("./db-writer.js");
      const result = await checkAlreadyImported(pool, sha256);
      alreadyImported = { isDuplicate: result.alreadyImported, priorImportId: result.importId };
    } catch {
      /* degrada a "unknown", nunca aborta el dry-run */
    } finally {
      await pool.end();
    }
  }

  const report = buildDryRunReport({ filePath: args.file, sha256, bundle, validation, alreadyImported, dbPeekAvailable });
  const reportPath = await writeDryRunReport(report);

  console.log(`Dry-run completo (sin escrituras). Reporte: ${reportPath}`);
  console.log(`Filas: read=${report.rows.read} accepted=${report.rows.accepted} ignored=${report.rows.ignored} errored=${report.rows.errored}`);
  console.log(`Cobertura: ${report.coverage.start} -> ${report.coverage.endExclusive}`);
  console.log(`Por tipo: ${JSON.stringify(report.countsByType)}`);
  if (report.coincidentDates.length > 0) {
    console.log(`Fechas con eventos coincidentes: ${report.coincidentDates.map(c => c.localDate).join(", ")}`);
  }
  if (!validation.ok) {
    console.error(`INVÁLIDO -no se puede aplicar tal cual. ${validation.errors.length} error(es).`);
    process.exitCode = 1;
  }
}

async function runApply(args) {
  const { bundle, sha256, validation } = await loadAndValidate(args.file);
  if (!validation.ok) {
    console.error(`No se puede aplicar: el bundle tiene ${validation.errors.length} error(es) de validación.`);
    for (const e of validation.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const { createPool, getConnectionString } = await import("./db-client.js");
  const { applyBundle } = await import("./db-writer.js");
  // ETAPA SAFETY-1 (Policy C) - evalúa el destino ANTES de abrir la conexión.
  // DEPLOY NEXUS 2026-07 - mismo opt-in dual-token que migrate-to-supabase.js
  // (ver ese archivo); sin AMBOS CONFIRM_WRITE_TARGET/CONFIRM_PROTECTED_WRITE_TARGET
  // exactos, sigue abortando igual que antes.
  assertWriteConfirmed(getConnectionString(), { environment: process.env.NODE_ENV ?? "development", allowProtectedWithDualConfirmation: true });
  const pool = createPool({ applicationName: `holidays-apply:${randomUUID().slice(0, 8)}` });
  try {
    const result = await applyBundle({ pool, filename: args.file, sha256, bundle, resolvedEvents: validation.resolvedEvents });
    if (result.alreadyImported) {
      console.log(`Ya importado anteriormente (import_id=${result.importId}). Cero filas nuevas.`);
    } else {
      console.log(`Aplicado. import_id=${result.importId}, coverage_id=${result.coverageId} (DRAFT -no VALIDATED automáticamente), filas=${result.rowsAccepted}.`);
    }
  } finally {
    await pool.end();
  }
}

async function runPublish(args) {
  const { createPool, getConnectionString } = await import("./db-client.js");
  const { publishCoverage } = await import("./publish-coverage.js");
  // ETAPA SAFETY-1 (Policy C) - evalúa el destino ANTES de abrir la conexión.
  // DEPLOY NEXUS 2026-07 - mismo opt-in dual-token que migrate-to-supabase.js.
  assertWriteConfirmed(getConnectionString(), { environment: process.env.NODE_ENV ?? "development", allowProtectedWithDualConfirmation: true });
  const pool = createPool({ applicationName: `holidays-publish:${randomUUID().slice(0, 8)}` });
  try {
    const result = await publishCoverage(pool, {
      coverageId: Number(args.coverageId),
      supersedeCoverageId: args.supersedeCoverageId ? Number(args.supersedeCoverageId) : null
    });
    console.log(`Publicado. coverage_id=${result.publishedCoverageId} ahora VALIDATED.`);
  } finally {
    await pool.end();
  }
}

export async function runCli(argv) {
  const args = parseArgs(argv);
  const validation = validateArgs(args);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  switch (args.subcommand) {
    case "validate":
      return runValidate(args);
    case "dry-run":
      return runDryRun(args);
    case "apply":
      return runApply(args);
    case "publish":
      return runPublish(args);
    default:
      throw new Error(`Subcomando desconocido: ${args.subcommand}`);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).catch(error => {
    console.error("ERROR:");
    console.error(error);
    process.exit(1);
  });
}
