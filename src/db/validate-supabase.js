import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "./warehouse-config.js";
import { mapType, postgresTypeMatchesDuckdb } from "./generate-postgres-ddl.js";
import { listOwnershipEntries } from "./ownership-manifest.js";
import { validateWarehouseState } from "./warehouse-validation.js";
import { buildWriteConfirmationToken, describeConnectionTarget } from "../lib/db-safety.js";

const SUMMARY_FILE = "data/reports/supabase_validation_summary.json";
const RUN_ID_FILE = "data/reports/supabase_sync_run_id.json";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function validationSchemas() {
  return [...new Set(listOwnershipEntries().map(entry => entry.schema))].sort();
}

async function attachPostgresReadOnly(connection, connectionString) {
  await connection.run("INSTALL postgres");
  await connection.run("LOAD postgres");
  await connection.run(`ATTACH ${quoteSqlLiteral(connectionString)} AS pg (TYPE postgres, READ_ONLY)`);
}

async function readInventory(connection) {
  const schemas = validationSchemas();
  const schemaList = schemas.map(quoteSqlLiteral).join(",");

  const duckReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN (${schemaList})
       AND table_catalog = current_catalog()
       AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name`
  );

  const postgresReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM pg.information_schema.tables
     WHERE table_schema IN (${schemaList})
       AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name`
  );

  const viewsReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM pg.information_schema.views
     WHERE table_schema IN (${schemaList})
     ORDER BY table_schema, table_name`
  );

  const columnsReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name, column_name
     FROM pg.information_schema.columns
     WHERE table_schema IN (${schemaList})
     ORDER BY table_schema, table_name, ordinal_position`
  );

  const postgresColumnsByTable = {};
  for (const column of columnsReader.getRowObjects()) {
    const key = `${column.table_schema}.${column.table_name}`;
    if (!postgresColumnsByTable[key]) postgresColumnsByTable[key] = [];
    postgresColumnsByTable[key].push(column.column_name);
  }

  return {
    duckdbTables: duckReader.getRowObjects().map(row => ({ schema: row.table_schema, table: row.table_name })),
    postgresTables: postgresReader.getRowObjects().map(row => ({ schema: row.table_schema, table: row.table_name })),
    postgresViews: viewsReader.getRowObjects().map(row => ({ schema: row.table_schema, view: row.table_name })),
    postgresColumnsByTable
  };
}

async function compareDuckdbSync(connection, entry) {
  const schema = quoteIdentifier(entry.schema);
  const table = quoteIdentifier(entry.name);
  const key = `${entry.schema}.${entry.name}`;

  const duckCountReader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${schema}.${table}`);
  const postgresCountReader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM pg.${schema}.${table}`);
  const duckdbRowCount = Number(duckCountReader.getRowObjects()[0].n);
  const postgresRowCount = Number(postgresCountReader.getRowObjects()[0].n);

  const duckColumnsReader = await connection.runAndReadAll(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_catalog = current_catalog()
       AND table_schema = ${quoteSqlLiteral(entry.schema)}
       AND table_name = ${quoteSqlLiteral(entry.name)}
     ORDER BY ordinal_position`
  );
  const postgresColumnsReader = await connection.runAndReadAll(
    `SELECT column_name, data_type
     FROM pg.information_schema.columns
     WHERE table_schema = ${quoteSqlLiteral(entry.schema)}
       AND table_name = ${quoteSqlLiteral(entry.name)}
     ORDER BY ordinal_position`
  );

  const duckColumns = duckColumnsReader.getRowObjects();
  const postgresColumns = postgresColumnsReader.getRowObjects();
  const duckByName = new Map(duckColumns.map(column => [column.column_name, column.data_type]));
  const postgresByName = new Map(postgresColumns.map(column => [column.column_name, column.data_type]));
  const missingColumns = [...duckByName.keys()].filter(name => !postgresByName.has(name));
  const extraColumns = [...postgresByName.keys()].filter(name => !duckByName.has(name));
  const typeMismatches = [];

  for (const [name, duckdbType] of duckByName) {
    const postgresType = postgresByName.get(name);
    if (!postgresType) continue;
    if (!postgresTypeMatchesDuckdb(duckdbType, postgresType)) {
      typeMismatches.push({
        column: name,
        duckdb_type: duckdbType,
        expected_pg_type: mapType(duckdbType),
        actual_pg_type: postgresType
      });
    }
  }

  const status =
    duckdbRowCount === postgresRowCount &&
    missingColumns.length === 0 &&
    extraColumns.length === 0 &&
    typeMismatches.length === 0
      ? "MATCH"
      : "MISMATCH";

  return {
    object: key,
    status,
    duckdb_row_count: duckdbRowCount,
    postgres_row_count: postgresRowCount,
    missing_columns: missingColumns,
    extra_columns: extraColumns,
    type_mismatches: typeMismatches
  };
}

export { validateWarehouseState };

export function buildValidationProvenance(connectionString, runRecord = null) {
  const target = buildWriteConfirmationToken(describeConnectionTarget(connectionString));
  return {
    target,
    sync_run_id: runRecord?.target === target && runRecord?.run_id ? runRecord.run_id : null
  };
}

async function readRunRecord() {
  try {
    return JSON.parse(await fs.readFile(RUN_ID_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function validateSupabase() {
  console.log("=== Validando DuckDB -> PostgreSQL (read-only) ===");
  const connectionString = requireEnv("SUPABASE_DB_URL_DIRECT");
  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();

  try {
    await attachPostgresReadOnly(connection, connectionString);
    const inventory = await readInventory(connection);
    const summary = await validateWarehouseState({
      ...inventory,
      compareDuckdbSync: entry => compareDuckdbSync(connection, entry)
    });
    summary.provenance = buildValidationProvenance(connectionString, await readRunRecord());

    await fs.mkdir("data/reports", { recursive: true });
    await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
    console.log(`Resumen local guardado en ${SUMMARY_FILE}`);
    console.log(`=== Validación ${summary.validation_status} (sin escrituras PostgreSQL) ===`);

    if (summary.validation_status !== "PASSED") {
      const error = new Error("Validación FAILED. Ver causas en el resumen local.");
      error.summary = summary;
      throw error;
    }

    return summary;
  } finally {
    connection.closeSync();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  validateSupabase().catch(error => {
    console.error("ERROR VALIDANDO POSTGRESQL:");
    console.error(error);
    process.exit(1);
  });
}
