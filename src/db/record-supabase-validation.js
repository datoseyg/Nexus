import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertWriteConfirmed, buildWriteConfirmationToken, describeConnectionTarget } from "../lib/db-safety.js";

const { Pool } = pg;
const RUN_ID_FILE = "data/reports/supabase_sync_run_id.json";
const SUMMARY_FILE = "data/reports/supabase_validation_summary.json";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

function isLocalHost(connectionString) {
  const { hostname } = new URL(connectionString);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

async function defaultExecuteUpdate(connectionString, values) {
  const pool = new Pool({
    connectionString,
    application_name: "nexus-record-validation",
    ssl: isLocalHost(connectionString) ? false : { rejectUnauthorized: false },
    max: 1
  });

  try {
    return await pool.query(
      `UPDATE audit.warehouse_sync_state
       SET validation_status = $1,
           validation_summary = $2::jsonb
       WHERE run_id = $3`,
      [values.validationStatus, JSON.stringify(values.summary), values.runId]
    );
  } finally {
    await pool.end();
  }
}

export async function recordValidationResult({
  connectionString,
  runId,
  summary,
  executeUpdate = values => defaultExecuteUpdate(connectionString, values)
}) {
  if (summary?.validation_status !== "PASSED" && summary?.validation_status !== "FAILED") {
    throw new Error("El resumen debe declarar validation_status PASSED o FAILED.");
  }
  if (!runId) throw new Error("Falta runId para registrar la validación.");

  const target = buildWriteConfirmationToken(describeConnectionTarget(connectionString));
  if (!summary?.provenance?.target || !summary?.provenance?.sync_run_id) {
    throw new Error("El resumen no contiene procedencia enlazada (destino y run_id); vuelva a ejecutar la validación.");
  }
  if (summary.provenance.sync_run_id !== runId) {
    throw new Error("El run_id del resumen no coincide con la migración que se intenta registrar.");
  }
  if (summary.provenance.target !== target) {
    throw new Error("El destino del resumen no coincide con la conexión efectiva del registro.");
  }

  // Operación de escritura explícita. El opt-in no salta el guard: en un
  // destino protegido exige ambos tokens exactos host:port/database.
  assertWriteConfirmed(connectionString, {
    environment: process.env.NODE_ENV ?? "development",
    applicationName: "nexus-record-validation",
    allowProtectedWithDualConfirmation: true
  });

  const result = await executeUpdate({
    validationStatus: summary.validation_status,
    summary,
    runId
  });

  if (result?.rowCount !== 1) {
    throw new Error(`No se encontró exactamente una fila audit.warehouse_sync_state para run_id=${runId}.`);
  }

  return { recorded: true, runId, validationStatus: summary.validation_status };
}

export async function recordValidationFromLocalReports() {
  console.log("=== REGISTRO EXPLÍCITO DE VALIDACIÓN (ESCRIBE EN POSTGRESQL) ===");
  const [runRecord, summary] = await Promise.all([
    fs.readFile(RUN_ID_FILE, "utf8").then(JSON.parse),
    fs.readFile(SUMMARY_FILE, "utf8").then(JSON.parse)
  ]);

  const result = await recordValidationResult({
    connectionString: requireEnv("SUPABASE_DB_URL_DIRECT"),
    runId: runRecord.run_id,
    summary
  });
  console.log(`Validación ${result.validationStatus} registrada para run_id=${result.runId}.`);
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  recordValidationFromLocalReports().catch(error => {
    console.error("ERROR REGISTRANDO VALIDACIÓN:");
    console.error(error);
    process.exit(1);
  });
}
