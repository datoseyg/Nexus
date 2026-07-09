import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "./warehouse-config.js";


function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function postgresExecute(connection, sql) {
  await connection.run(
    `CALL postgres_execute('pg', ${quoteSqlLiteral(sql)})`
  );
}


// Migración DuckDB -> Postgres (Fase 2). Idempotente y repetible: se corre
// de nuevo después de cada `npm run build:gold` para resincronizar Postgres
// con el estado actual del .duckdb, vía TRUNCATE + INSERT (nunca DROP, para
// no perder los GRANT ya otorgados en sql/000).
//
// Alcance del truncate/reload — límites explícitos: SOLO processed/marts/gold
// (+ raw si LOAD_RAW=true). manual_review/stock/audit quedan completamente
// fuera del loop — son transaccionales, solo entran vía los endpoints CRUD
// o el logueo del propio pipeline. El filtro de information_schema de abajo
// hace estructuralmente imposible que este script los toque por accidente.
const SYNC_SCHEMAS = ["processed", "marts", "gold"];
const RAW_PLATFORMS = ["zendesk", "fieldbeat", "dolibarr"];
const RUN_ID_FILE = "data/reports/supabase_sync_run_id.json";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en .env — necesaria para conectar a Supabase (conexión directa, puerto 5432).`);
  }
  return value;
}

async function attachPostgres(connection) {
  // SUPABASE_DB_URL_DIRECT debe usar el rol `postgres` (superusuario), NO
  // `nexus_app`. Este script hace TRUNCATE sobre processed/marts/gold, y
  // nexus_app tiene a propósito solo SELECT ahí (defensa en profundidad -
  // ver sql/000_roles_and_schemas.sql y docs/RUNBOOK_SUPABASE_NETLIFY.md
  // § 4). Conectado como nexus_app esto falla con
  // "permission denied for table ..." - es el guardrail funcionando como
  // se diseñó, no un bug a parchear dándole más privilegios a nexus_app.
  const directUrl = requireEnv("SUPABASE_DB_URL_DIRECT");
  await connection.run("INSTALL postgres");
  await connection.run("LOAD postgres");
  // ATTACH toma un connection string libpq (postgresql://user:pass@host:port/db).
  await connection.run(`ATTACH '${directUrl}' AS pg (TYPE postgres)`);
}

async function syncMedallionTables(connection) {
  // table_catalog = current_catalog() es obligatorio acá: una vez que
  // ATTACH crea el catálogo "pg", ese catálogo TAMBIÉN tiene schemas
  // processed/marts/gold con los mismos nombres de tabla (sql/010-030 ya
  // los creó del lado Postgres) - sin este filtro, information_schema.tables
  // sin calificar devuelve cada tabla DOS VECES (una por catálogo), y el
  // loop de abajo sincroniza cada tabla dos veces de forma redundante.
  const tablesReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN ('${SYNC_SCHEMAS.join("','")}')
       AND table_catalog = current_catalog()
     ORDER BY table_schema, table_name`
  );
  const tables = tablesReader.getRowObjects();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const { table_schema: schema, table_name: table } of tables) {
    const fq = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const pgFq = `pg.${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;


    try {
      await postgresExecute(
        connection,
        `TRUNCATE TABLE "${schema}"."${table}" RESTART IDENTITY CASCADE`
      );

      await connection.run(`INSERT INTO ${pgFq} SELECT * FROM ${fq}`);
      console.log(`Sincronizada ${schema}.${table}`);
      migrated++;
    } catch (error) {
      console.error(`ERROR sincronizando ${schema}.${table}: ${error.message}`);
      failed++;
    }
  }

  return { migrated, skipped, failed, totalTables: tables.length };
}

async function syncRawJson(connection) {
  let migrated = 0;
  let failed = 0;

  for (const platform of RAW_PLATFORMS) {
    const table = `${platform === "dolibarr" ? "dolibarr_products" : platform === "fieldbeat" ? "fieldbeat_tasks" : "zendesk_tickets"}_raw`;
    const globPath = `data/raw/${platform}/**/*.json`;

    try {
      await postgresExecute(
        connection,
        `TRUNCATE TABLE ${quoteIdentifier("raw")}.${quoteIdentifier(table)} RESTART IDENTITY CASCADE`
      );
      await connection.run(`
        INSERT INTO pg.raw."${table}" (source_file, fetched_at, payload)
        SELECT filename, now(), content::JSON
        FROM read_text('${globPath}')
      `);
      console.log(`Sincronizado raw.${table} desde ${globPath}`);
      migrated++;
    } catch (error) {
      console.error(`ERROR sincronizando raw.${table}: ${error.message} (¿no hay archivos en ${globPath}?)`);
      failed++;
    }
  }

  return { migrated, failed };
}

export async function migrateToSupabase() {
  console.log("=== Migrando DuckDB -> Supabase Postgres ===");

  const loadRaw = process.env.LOAD_RAW === "true";
  console.log(`LOAD_RAW=${loadRaw} (default: false — ver riesgo de presupuesto de espacio en el plan de migración)`);

  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_WRITE" });
  const connection = await instance.connect();

  await attachPostgres(connection);

  const medallionResult = await syncMedallionTables(connection);

  let rawResult = { migrated: 0, failed: 0 };
  if (loadRaw) {
    rawResult = await syncRawJson(connection);
  }

  const runId = crypto.randomUUID();
  const tablesMigrated = medallionResult.migrated + rawResult.migrated;
  const tablesSkipped = medallionResult.skipped;
  const tablesFailed = medallionResult.failed + rawResult.failed;

  await connection.run(
    `INSERT INTO pg.audit.warehouse_sync_state
       (run_id, tables_migrated, tables_skipped, tables_failed, validation_status, duckdb_source_path, triggered_by)
     VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)`,
    [runId, tablesMigrated, tablesSkipped, tablesFailed, DB_PATH, process.env.USER ?? process.env.USERNAME ?? "unknown"]
  );

  connection.closeSync();

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(RUN_ID_FILE, JSON.stringify({ run_id: runId, migrated_at: new Date().toISOString() }, null, 2), "utf8");

  console.log(`=== Migración finalizada: ${tablesMigrated} sincronizadas, ${tablesSkipped} saltadas, ${tablesFailed} con error ===`);
  console.log(`run_id: ${runId} (guardado en ${RUN_ID_FILE} para que validate-supabase.js lo recoja)`);

  if (tablesFailed > 0) {
    throw new Error(`${tablesFailed} tabla(s) fallaron al sincronizar. Ver detalle arriba.`);
  }

  return { runId, tablesMigrated, tablesSkipped, tablesFailed };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateToSupabase().catch(error => {
    console.error("ERROR MIGRANDO A SUPABASE:");
    console.error(error);
    process.exit(1);
  });
}
