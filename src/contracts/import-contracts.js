import { fileURLToPath } from "node:url";
import { readSourceCsvRaw } from "./csv-source.js";
import { classifyRows } from "./row-classifier.js";
import { buildEquipmentRecord } from "./record-builder.js";
import { createClientNameNormalizer } from "./normalize-client.js";
import { matchAll } from "./fieldbeat-matcher.js";
import { loadClientIdentityAliases, buildClientIdentityAliasIndex } from "./client-identity-aliases.js";
import { loadDryRunDatabaseState } from "./dry-run-db-state.js";
import { buildDryRunReport, writeDryRunReport } from "./dry-run-report.js";
import { parseArgs, validateArgs } from "./cli.js";
import { readCsv } from "../lib/csv.js";
import { CONTRACT_TRANSFORM_VERSION } from "./transform-version.js";

const FIELDBEAT_EQUIPMENTS_CSV = "data/processed/fieldbeat/DIM_Equipments.csv";
const FIELDBEAT_CLIENTS_CSV = "data/processed/fieldbeat/DIM_Clients.csv";

function extractSheetNameFromFilename(filePath) {
  // Convención de exportación de Google Sheets: "<Libro> - <Hoja>.csv".
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const match = base.match(/ - ([^-]+)\.csv$/i);
  return match ? match[1].trim() : null;
}

/**
 * Intenta un peek de solo lectura, best-effort, contra Postgres (para
 * versionAction/matching más precisos en el reporte de dry-run). Nunca
 * aborta el dry-run si falla -degrada silenciosamente a "no disponible".
 * Implementado como best-effort porque en esta etapa el módulo db-client.js
 * puede no estar disponible/instalado según el momento de la corrida.
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

async function runDryRun(args) {
  const { rawBuffer, sourceSha256, header, dataRows } = await readSourceCsvRaw(args.file);
  void rawBuffer;
  void header;

  const { equipmentRows, ignoredRows, erroredRows } = classifyRows(dataRows);

  if (erroredRows.length > 0) {
    console.error(`ADVERTENCIA: ${erroredRows.length} fila(s) estructuralmente inválida(s) -en --apply esto sería FATAL (rollback completo).`);
  }

  // effective-date es opcional en dry-run; si no se dio, se usa hoy para
  // que notes-parser.js pueda evaluar WARRANTY_END_DATE_PASSED igual
  // (informativo solamente -no se persiste nada en dry-run).
  const effectiveDateForParsing = args.effectiveDate ?? new Date().toISOString().slice(0, 10);

  const clientNameNormalizer = createClientNameNormalizer();
  const records = equipmentRows.map(row => buildEquipmentRecord(row, effectiveDateForParsing, clientNameNormalizer));

  const { pool, available: dbPeekAvailable } = await tryConnectedPeek();

  let matchSource = "CSV";
  let fieldbeatEquipments;
  let fieldbeatClients;
  let overrides = [];
  let alreadyImported = { isDuplicate: "unknown", priorImportId: null };
  let versionActions = new Map();

  if (dbPeekAvailable) {
    matchSource = "DB";
    const equipmentsResult = await pool.query("SELECT equipment_key, equipment_uuid, internal_id, client_key FROM processed.fieldbeat_equipments");
    const clientsResult = await pool.query("SELECT client_key, client_name FROM processed.fieldbeat_clients");
    fieldbeatEquipments = equipmentsResult.rows;
    fieldbeatClients = clientsResult.rows;

    const overridesResult = await pool.query(
      "SELECT equipment_key, fieldbeat_equipment_id FROM config.contract_equipment_match_overrides WHERE active = true"
    ).catch(() => ({ rows: [] }));
    overrides = overridesResult.rows.map(r => ({ equipmentKey: r.equipment_key, fieldbeatEquipmentId: r.fieldbeat_equipment_id }));
    ({ alreadyImported, versionActions } = await loadDryRunDatabaseState(pool, {
      sourceSha256,
      transformVersion: CONTRACT_TRANSFORM_VERSION,
      records,
      effectiveDate: effectiveDateForParsing
    }));
    await pool.end();
  } else {
    fieldbeatEquipments = await readCsv(FIELDBEAT_EQUIPMENTS_CSV);
    fieldbeatClients = await readCsv(FIELDBEAT_CLIENTS_CSV);
  }

  const candidates = records.map(r => ({
    equipmentKey: r.equipmentKey,
    clientNameCanonical: r.normalizedFields.clientNameCanonical,
    equipmentModel: r.normalizedFields.equipmentModel,
    serialNumber: r.normalizedFields.serialNumber
  }));
  // ETAPA 6.5.2B1 - misma gobernanza de alias que --apply (db-writer.js),
  // para que el reporte de dry-run refleje el resultado real de matching.
  const clientAliasIndex = buildClientIdentityAliasIndex(loadClientIdentityAliases());
  const matches = matchAll(candidates, { fieldbeatEquipments, fieldbeatClients, overrides, clientAliasIndex });

  const report = buildDryRunReport({
    sourceFile: args.file,
    sourceSha256,
    sourceSheet: extractSheetNameFromFilename(args.file),
    rows: dataRows,
    ignoredRows,
    erroredRows,
    records,
    matchSource,
    matches,
    alreadyImported,
    dbPeekAvailable,
    versionActions,
    transformVersion: CONTRACT_TRANSFORM_VERSION
  });

  const reportPath = await writeDryRunReport(report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReporte guardado en: ${reportPath}`);
  console.log(`Filas: ${report.rows.read} leídas, ${report.rows.accepted} aceptadas, ${report.rows.ignored} ignoradas, ${report.rows.errored} erroradas.`);
  console.log("No se escribió nada en la base de datos (dry-run).");
}

async function runApply(args) {
  // Implementado en la Fase 9 del plan (db-writer.js + versioning.js).
  const { applyContracts } = await import("./db-writer.js");
  await applyContracts(args);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = validateArgs(args);

  if (!validation.ok) {
    console.error(`Argumentos inválidos: ${validation.reason}`);
    process.exit(1);
  }

  if (args.mode === "apply") {
    await runApply(args);
  } else {
    await runDryRun(args);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error("ERROR EN LA IMPORTACIÓN DE CONTRATOS:");
    console.error(error);
    process.exit(1);
  });
}

export { runDryRun, runApply };
