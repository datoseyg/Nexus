import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "../db/warehouse-config.js";

const SUMMARY_FILE = "data/reports/phase1_final_audit_summary.json";
const VALIDATION_SUMMARY_FILE = "data/reports/duckdb_validation_summary.json";
const SQL_QUERY_PACK_DIR = "sql";

const REQUIRED_DOCS = [
  "docs/DATA_DICTIONARY.md",
  "docs/PHASE_1_CLOSEOUT.md",
  "docs/LOCAL_OPERATIONS_RUNBOOK.md",
  "docs/BI_READINESS.md",
  "docs/QUERY_GUIDE.md",
  "docs/KNOWN_LIMITATIONS_PHASE_1.md",
  "docs/PHASE_2_HANDOFF.md"
];

// "aprox" a propósito: esta auditoría no debe fallar si el pipeline se
// vuelve a correr con datos nuevos y los conteos cambian. Solo se marca
// problema si la tabla esperada directamente NO EXISTE.
const EXPECTED_TABLES = [
  { table: "processed.zendesk_tickets", approx: 628 },
  { table: "processed.fieldbeat_tasks", approx: 3747 },
  { table: "processed.fieldbeat_used_parts", approx: 2193 },
  { table: "processed.dolibarr_products", approx: 1609 },
  { table: "marts.fieldbeat_report_dolibarr_operational_view", approx: 3747 },
  { table: "gold.fieldbeat_report_analysis", approx: 1 }
];

const KNOWN_PHASE2_BLOCKERS = [
  "291 Zendesk ticket IDs con 403 Forbidden (data/reports/zendesk_ticket_ids_not_accessible_403.json).",
  "Migración serverless pendiente.",
  "Publicación BI pendiente.",
  "Movimientos de stock Dolibarr fuera de alcance de Fase 1."
];

const RECOMMENDED_NEXT_STEP = "Validar KPIs con stakeholders y preparar publicación BI.";

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path) {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function auditPhase1() {
  console.log("=== Auditoría final de cierre de Fase 1 ===");

  const missingExpectedDocs = [];
  for (const doc of REQUIRED_DOCS) {
    if (!(await fileExists(doc))) missingExpectedDocs.push(doc);
  }

  const duckdbFileExists = await fileExists(DB_PATH);
  const validationSummaryExists = await fileExists(VALIDATION_SUMMARY_FILE);
  const sqlQueryPackExists = await dirExists(SQL_QUERY_PACK_DIR);

  let sqlQueryPackFileCount = 0;
  if (sqlQueryPackExists) {
    const entries = await fs.readdir(SQL_QUERY_PACK_DIR);
    sqlQueryPackFileCount = entries.filter(f => f.endsWith(".sql")).length;
  }

  let duckdbAllMatch = null;
  if (validationSummaryExists) {
    try {
      const raw = await fs.readFile(VALIDATION_SUMMARY_FILE, "utf8");
      duckdbAllMatch = JSON.parse(raw).all_match ?? null;
    } catch (error) {
      console.warn(`No se pudo leer ${VALIDATION_SUMMARY_FILE}: ${error.message}`);
    }
  }

  let duckdbAccessible = false;
  let totalDuckdbSchemas = 0;
  let totalDuckdbTables = 0;
  let tablesBySchema = {};
  let missingExpectedTables = [];
  let expectedTableCounts = [];

  if (duckdbFileExists) {
    try {
      // READ_ONLY: esta auditoría no debe requerir exclusividad sobre el
      // archivo - si otro proceso (DBeaver, etc.) lo tiene abierto en
      // lectura-escritura igual puede fallar, y eso se reporta como
      // advertencia, no como excepción no controlada.
      const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
      const connection = await instance.connect();
      duckdbAccessible = true;

      const tablesResult = await connection.runAndReadAll(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema IN ('processed', 'marts', 'gold', 'reports')
        ORDER BY table_schema, table_name
      `);
      const tables = tablesResult.getRowObjects();
      totalDuckdbTables = tables.length;

      for (const t of tables) {
        tablesBySchema[t.table_schema] = (tablesBySchema[t.table_schema] || 0) + 1;
      }
      totalDuckdbSchemas = Object.keys(tablesBySchema).length;

      const existingTableNames = new Set(tables.map(t => `${t.table_schema}.${t.table_name}`));

      for (const expected of EXPECTED_TABLES) {
        if (!existingTableNames.has(expected.table)) {
          missingExpectedTables.push(expected.table);
          continue;
        }

        const countResult = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${expected.table}`);
        const actual = Number(countResult.getRowObjects()[0].n);
        expectedTableCounts.push({ table: expected.table, expected_approx: expected.approx, actual });

        console.log(`${expected.table}: esperado ~${expected.approx}, real ${actual}`);
      }

      connection.closeSync();
    } catch (error) {
      console.warn(`No se pudo consultar DuckDB en vivo (¿archivo bloqueado por otro proceso, ej. DBeaver?): ${error.message}`);
      duckdbAccessible = false;
    }
  }

  // Estado final:
  // - NOT_READY: falta algo estructural (el archivo de la BDD, un doc
  //   requerido, la carpeta sql/, o una validación explícita fallida).
  // - READY_WITH_WARNINGS: todo lo estructural está, pero hay señales
  //   blandas (no se pudo consultar la BDD en vivo, o falta alguna de
  //   las tablas de referencia, o nunca se corrió db:validate).
  // - READY: todo presente y consistente.
  let phase1Status;

  if (!duckdbFileExists || duckdbAllMatch === false || missingExpectedDocs.length > 0 || !sqlQueryPackExists) {
    phase1Status = "NOT_READY";
  } else if (!duckdbAccessible || missingExpectedTables.length > 0 || duckdbAllMatch === null) {
    phase1Status = "READY_WITH_WARNINGS";
  } else {
    phase1Status = "READY";
  }

  const summary = {
    generated_at: new Date().toISOString(),
    phase1_status: phase1Status,
    duckdb_file_exists: duckdbFileExists,
    duckdb_accessible: duckdbAccessible,
    duckdb_all_match: duckdbAllMatch,
    total_duckdb_schemas: totalDuckdbSchemas,
    total_duckdb_tables: totalDuckdbTables,
    tables_by_schema: tablesBySchema,
    expected_table_counts: expectedTableCounts,
    missing_expected_tables: missingExpectedTables,
    missing_expected_docs: missingExpectedDocs,
    sql_query_pack_exists: sqlQueryPackExists,
    sql_query_pack_file_count: sqlQueryPackFileCount,
    known_phase2_blockers: KNOWN_PHASE2_BLOCKERS,
    recommended_next_step: RECOMMENDED_NEXT_STEP
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`=== Estado final de Fase 1: ${phase1Status} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  auditPhase1().catch(error => {
    console.error("ERROR EN AUDITORÍA DE CIERRE DE FASE 1:");
    console.error(error);
    process.exit(1);
  });
}
