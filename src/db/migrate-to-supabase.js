import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "./warehouse-config.js";
import { classifyOwnership, isDuckdbSync } from "./ownership-manifest.js";
import { assertWriteConfirmed, assertKnownSupabaseProject, buildWriteConfirmationToken, describeConnectionTarget } from "../lib/db-safety.js";


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
// con el estado actual del .duckdb. Cada carga se prepara en staging y el
// reemplazo TRUNCATE + INSERT se confirma en una sola transacción (nunca
// DROP de la tabla publicada, para conservar los GRANT de sql/000).
//
// Alcance del truncate/reload -límites explícitos: SOLO processed/marts/gold
// (+ raw si LOAD_RAW=true). manual_review/stock/audit quedan completamente
// fuera del loop -son transaccionales, solo entran vía los endpoints CRUD
// o el logueo del propio pipeline. El filtro de information_schema de abajo
// hace estructuralmente imposible que este script los toque por accidente.
const SYNC_SCHEMAS = ["processed", "marts", "gold"];
const RAW_PLATFORMS = ["zendesk", "fieldbeat", "dolibarr"];
const RUN_ID_FILE = "data/reports/supabase_sync_run_id.json";

export function assertNoUnknownTables(tables) {
  const unknown = tables
    .map(({ table_schema: schema, table_name: table }) => classifyOwnership(schema, table))
    .filter(classification => !classification.known)
    .map(classification => classification.key)
    .sort();
  if (unknown.length > 0) {
    throw new Error(`OBJETOS DESCONOCIDOS sin clasificación explícita: ${unknown.join(", ")}. Se aborta antes de cualquier TRUNCATE.`);
  }
}

export function buildNamedColumnInsert(schema, table, columns) {
  if (!columns.length) throw new Error(`No se encontraron columnas para ${schema}.${table}.`);
  const names = columns.map(quoteIdentifier).join(", ");
  return `INSERT INTO pg.${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${names}) SELECT ${names} FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function buildAtomicReplaceSql(schema, table, stagingTable, columns) {
  if (!columns.length) throw new Error(`No se encontraron columnas para ${schema}.${table}.`);
  const names = columns.map(quoteIdentifier).join(", ");
  const target = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const staging = `${quoteIdentifier(schema)}.${quoteIdentifier(stagingTable)}`;
  return [
    "BEGIN;",
    `TRUNCATE TABLE ${target} RESTART IDENTITY;`,
    `INSERT INTO ${target} (${names}) SELECT ${names} FROM ${staging};`,
    `DROP TABLE ${staging};`,
    "COMMIT;"
  ].join("\n");
}

function stagingTableName(schema, table) {
  return `_nexus_sync_${createHash("sha256").update(`${schema}.${table}`).digest("hex").slice(0, 16)}`;
}

async function replaceViaStaging(connection, { schema, table, columns, sourceSelect }) {
  const stagingTable = stagingTableName(schema, table);
  const target = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const staging = `${quoteIdentifier(schema)}.${quoteIdentifier(stagingTable)}`;
  const names = columns.map(quoteIdentifier).join(", ");

  await postgresExecute(connection, `DROP TABLE IF EXISTS ${staging}; CREATE UNLOGGED TABLE ${staging} (LIKE ${target} INCLUDING DEFAULTS)`);
  try {
    await connection.run(`INSERT INTO pg.${staging} (${names}) ${sourceSelect}`);
    await postgresExecute(connection, buildAtomicReplaceSql(schema, table, stagingTable, columns));
  } catch (error) {
    try {
      await postgresExecute(connection, `DROP TABLE IF EXISTS ${staging}`);
    } catch {
      // La limpieza es best-effort; la tabla publicada nunca se modifica
      // hasta el swap transaccional posterior a una carga staging exitosa.
    }
    throw error;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en .env -necesaria para conectar a Supabase (conexión directa, puerto 5432).`);
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

export async function syncMedallionTables(connection) {
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
  assertNoUnknownTables(tables);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const { table_schema: schema, table_name: table } of tables) {
    // ETAPA 6.6B0: solo se sincronizan tablas declaradas DUCKDB_SYNC en el
    // manifiesto de ownership (src/db/ownership-manifest.js). Sin este
    // filtro, cualquier tabla que exista en el .duckdb bajo processed/marts/
    // gold se sincroniza por accidente de descubrimiento de schema, sin
    // importar si tiene un generador real -el caso conocido es
    // marts.fieldbeat_working_hours_analysis (mart legado congelado, sin
    // builder en esta rama, ver docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md).
    if (!isDuckdbSync(schema, table)) {
      const classification = classifyOwnership(schema, table);
      const reason = classification.known
        ? `clasificada ${classification.ownership}`
        : "OBJETO DESCONOCIDO sin clasificación explícita";
      console.warn(`OMITIENDO ${schema}.${table}: ${reason}; no está declarada DUCKDB_SYNC en src/db/ownership-manifest.js -no se hace TRUNCATE ni INSERT.`);
      skipped++;
      continue;
    }

    try {
      const columnsReader = await connection.runAndReadAll(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_catalog = current_catalog()
           AND table_schema = ${quoteSqlLiteral(schema)}
           AND table_name = ${quoteSqlLiteral(table)}
         ORDER BY ordinal_position`
      );
      const columns = columnsReader.getRowObjects().map(column => column.column_name);
      const source = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
      await replaceViaStaging(connection, {
        schema,
        table,
        columns,
        sourceSelect: `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${source}`
      });
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
      await replaceViaStaging(connection, {
        schema: "raw",
        table,
        columns: ["source_file", "fetched_at", "payload"],
        sourceSelect: `
        SELECT filename, now(), content::JSON
        FROM read_text(${quoteSqlLiteral(globPath)})`
      });
      console.log(`Sincronizado raw.${table} desde ${globPath}`);
      migrated++;
    } catch (error) {
      console.error(`ERROR sincronizando raw.${table}: ${error.message} (¿no hay archivos en ${globPath}?)`);
      failed++;
    }
  }

  return { migrated, failed };
}

// dbPath es opcional (default: el .duckdb real del módulo) SOLO para poder
// probar esta función contra un .duckdb temporal y aislado (ver
// test/db/duckdb-freshness.test.js) - scripts/pipeline/run-data-refresh.mjs
// y la invocación CLI histórica (`npm run db:pg:migrate`) nunca lo pasan,
// ambos siguen migrando data/warehouse/eyg_nexus.duckdb tal cual.
export async function migrateToSupabase({ expectedProjectRefEnvVar, dbPath = DB_PATH } = {}) {
  console.log("=== Migrando DuckDB -> Supabase Postgres ===");

  // ETAPA SAFETY-1 (Policy D, corregida en el cierre) - este script SIEMPRE
  // apunta a un host protegido (Supabase cloud, vía SUPABASE_DB_URL_DIRECT).
  // No debe poder escribir ahí por defecto (allowProtectedWithDualConfirmation
  // habilita el chequeo, no lo salta), pero tampoco debe quedar
  // permanentemente inutilizable -exige AMBOS CONFIRM_WRITE_TARGET y
  // CONFIRM_PROTECTED_WRITE_TARGET, cada uno host:puerto/base EXACTOS del
  // destino efectivo (ver src/lib/db-safety.js), evaluado ANTES de tocar
  // DuckDB o abrir el ATTACH. Este opt-in es exclusivo de este script -los
  // demás callers de assertWriteConfirmed (contracts, holidays,
  // working-hours, validate-supabase) siguen sin poder escribir contra un
  // target protegido bajo ninguna circunstancia.
  const connectionString = requireEnv("SUPABASE_DB_URL_DIRECT");
  assertWriteConfirmed(connectionString, {
    environment: process.env.NODE_ENV ?? "development",
    allowProtectedWithDualConfirmation: true
  });

  // NEXUS V3 - guard V2/V3 (src/lib/db-safety.js::assertKnownSupabaseProject)
  // compuesto directo en el único punto de escritura real hacia Supabase,
  // para que TODO caller lo herede automáticamente (igual que ya heredan
  // assertWriteConfirmed arriba) - nunca un chequeo aparte que cada caller
  // nuevo tiene que acordarse de agregar. Opt-in vía parámetro (no
  // incondicional): la invocación CLI histórica de este script
  // (`npm run db:pg:migrate`, sin argumentos) sigue funcionando exactamente
  // igual que siempre para Nexus V2 -solo scripts/pipeline/run-data-refresh.mjs
  // pasa expectedProjectRefEnvVar='SUPABASE_PROJECT_REF_V3'.
  if (expectedProjectRefEnvVar) {
    assertKnownSupabaseProject(connectionString, { expectedProjectRefEnvVar });
  }

  const loadRaw = process.env.LOAD_RAW === "true";
  console.log(`LOAD_RAW=${loadRaw} (default: false -ver riesgo de presupuesto de espacio en el plan de migración)`);

  const instance = await DuckDBInstance.create(dbPath, { access_mode: "READ_WRITE" });
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
    [runId, tablesMigrated, tablesSkipped, tablesFailed, dbPath, process.env.USER ?? process.env.USERNAME ?? "unknown"]
  );

  connection.closeSync();
  // Ver el comentario equivalente en src/db/load-duckdb.js - sin esto,
  // validateSupabase() (que abre este mismo archivo más adelante, en
  // VALIDATE) podría fallar con el archivo aún bloqueado por esta migración.
  instance.closeSync();

  await fs.mkdir("data/reports", { recursive: true });
  const target = buildWriteConfirmationToken(describeConnectionTarget(connectionString));
  await fs.writeFile(RUN_ID_FILE, JSON.stringify({ run_id: runId, target, migrated_at: new Date().toISOString() }, null, 2), "utf8");

  console.log(`=== Migración finalizada: ${tablesMigrated} sincronizadas, ${tablesSkipped} saltadas, ${tablesFailed} con error ===`);
  console.log(`run_id: ${runId} (guardado en ${RUN_ID_FILE} para un registro opcional posterior)`);

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
