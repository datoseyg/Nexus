import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "./warehouse-config.js";
import { mapType } from "./generate-postgres-ddl.js";

// Validación de la migración a Supabase (Fase 2) — 4 chequeos, no solo
// conteo de filas: 1) filas, 2) tablas presentes, 3) columnas por tabla,
// 4) tipos principales. Falla con exit code != 0 si cualquiera no pasa,
// mismo criterio que src/db/validate-duckdb.js. Al terminar, actualiza la
// fila de audit.warehouse_sync_state que migrate-to-supabase.js insertó
// (mismo run_id).
const SYNC_SCHEMAS = ["processed", "marts", "gold"];
const RUN_ID_FILE = "data/reports/supabase_sync_run_id.json";
const SUMMARY_FILE = "data/reports/supabase_validation_summary.json";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

async function attachPostgres(connection) {
  const directUrl = requireEnv("SUPABASE_DB_URL_DIRECT");
  await connection.run("INSTALL postgres");
  await connection.run("LOAD postgres");
  await connection.run(`ATTACH '${directUrl}' AS pg (TYPE postgres)`);
}

export async function validateSupabase() {
  console.log("=== Validando migración a Supabase (4 chequeos) ===");

  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();
  await attachPostgres(connection);

  const duckTablesReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN ('${SYNC_SCHEMAS.join("','")}')
     ORDER BY table_schema, table_name`
  );
  const duckTables = duckTablesReader.getRowObjects();
  const duckTableKeys = new Set(duckTables.map(t => `${t.table_schema}.${t.table_name}`));

  const pgTablesReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM pg.information_schema.tables
     WHERE table_schema IN ('${SYNC_SCHEMAS.join("','")}')
     ORDER BY table_schema, table_name`
  );
  const pgTableKeys = new Set(pgTablesReader.getRowObjects().map(t => `${t.table_schema}.${t.table_name}`));

  // Chequeo 2: tablas esperadas vs presentes
  const missingInPostgres = [...duckTableKeys].filter(k => !pgTableKeys.has(k));
  const extraInPostgres = [...pgTableKeys].filter(k => !duckTableKeys.has(k));

  const tableResults = [];
  let allRowCountsMatch = true;
  let allColumnsMatch = true;
  let allTypesMatch = true;

  for (const { table_schema: schema, table_name: table } of duckTables) {
    const key = `${schema}.${table}`;

    if (!pgTableKeys.has(key)) {
      tableResults.push({ table: key, status: "MISSING_IN_POSTGRES" });
      allRowCountsMatch = false;
      continue;
    }

    // Chequeo 1: conteo de filas
    const duckCountReader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${schema}."${table}"`);
    const pgCountReader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM pg.${schema}."${table}"`);
    const duckCount = Number(duckCountReader.getRowObjects()[0].n);
    const pgCount = Number(pgCountReader.getRowObjects()[0].n);
    const rowCountStatus = duckCount === pgCount ? "MATCH" : "MISMATCH";
    if (rowCountStatus === "MISMATCH") allRowCountsMatch = false;

    // Chequeo 3: columnas por tabla
    const duckColsReader = await connection.runAndReadAll(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = '${table}' ORDER BY ordinal_position`
    );
    const pgColsReader = await connection.runAndReadAll(
      `SELECT column_name, data_type FROM pg.information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = '${table}' ORDER BY ordinal_position`
    );
    const duckCols = duckColsReader.getRowObjects();
    const pgColsByName = new Map(pgColsReader.getRowObjects().map(c => [c.column_name, c.data_type]));

    const missingColumns = duckCols.filter(c => !pgColsByName.has(c.column_name)).map(c => c.column_name);
    const extraColumns = [...pgColsByName.keys()].filter(name => !duckCols.some(c => c.column_name === name));

    if (missingColumns.length > 0 || extraColumns.length > 0) allColumnsMatch = false;

    // Chequeo 4: tipos principales (mismo mapeo que generate-postgres-ddl.js)
    const typeMismatches = [];
    for (const col of duckCols) {
      const pgType = pgColsByName.get(col.column_name);
      if (!pgType) continue; // ya reportado como missingColumns

      const expectedPgType = mapType(col.data_type).toLowerCase().replace(" precision", "");
      const actualPgType = pgType.toLowerCase().replace(" precision", "").replace("with time zone", "with time zone");
      const normalizedExpected = expectedPgType.includes("timestamptz") ? "timestamp with time zone" : expectedPgType;

      if (!actualPgType.includes(normalizedExpected.split(" ")[0])) {
        typeMismatches.push({ column: col.column_name, duckdb_type: col.data_type, expected_pg_type: mapType(col.data_type), actual_pg_type: pgType });
      }
    }
    if (typeMismatches.length > 0) allTypesMatch = false;

    const status = rowCountStatus === "MATCH" && missingColumns.length === 0 && extraColumns.length === 0 && typeMismatches.length === 0
      ? "MATCH"
      : "MISMATCH";

    tableResults.push({
      table: key,
      status,
      duckdb_row_count: duckCount,
      postgres_row_count: pgCount,
      missing_columns: missingColumns,
      extra_columns: extraColumns,
      type_mismatches: typeMismatches
    });

    console.log(`${key}: filas duckdb=${duckCount} pg=${pgCount}, columnas faltantes=${missingColumns.length}, tipos distintos=${typeMismatches.length} -> ${status}`);
  }

  const allPass = missingInPostgres.length === 0 && extraInPostgres.length === 0 && allRowCountsMatch && allColumnsMatch && allTypesMatch;
  const validationStatus = allPass ? "PASSED" : "FAILED";

  const summary = {
    generated_at: new Date().toISOString(),
    validation_status: validationStatus,
    checks: {
      tables_missing_in_postgres: missingInPostgres,
      tables_extra_in_postgres: extraInPostgres,
      row_counts_match: allRowCountsMatch,
      columns_match: allColumnsMatch,
      types_match: allTypesMatch
    },
    tables: tableResults
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);

  // Actualiza la fila de audit.warehouse_sync_state que migrate-to-supabase.js insertó (mismo run_id)
  try {
    const runIdFileContent = JSON.parse(await fs.readFile(RUN_ID_FILE, "utf8"));
    await connection.run(
      `UPDATE pg.audit.warehouse_sync_state
       SET validation_status = $1, validation_summary = $2
       WHERE run_id = $3`,
      [validationStatus, JSON.stringify(summary), runIdFileContent.run_id]
    );
    console.log(`audit.warehouse_sync_state actualizada (run_id ${runIdFileContent.run_id})`);
  } catch (error) {
    console.warn(`No se pudo actualizar audit.warehouse_sync_state: ${error.message} (¿corriste migrate-to-supabase.js antes?)`);
  }

  connection.closeSync();

  console.log(`=== Validación ${validationStatus} ===`);

  if (!allPass) {
    throw new Error("Validación falló: al menos uno de los 4 chequeos no pasó. Ver detalle arriba y en el resumen JSON.");
  }

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  validateSupabase().catch(error => {
    console.error("ERROR VALIDANDO SUPABASE:");
    console.error(error);
    process.exit(1);
  });
}
