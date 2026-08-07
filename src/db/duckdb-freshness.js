// NEXUS V3 - guardas de frescura para la etapa LOAD_DUCKDB del orquestador
// (scripts/pipeline/run-data-refresh.mjs), entre BUILD_GOLD y SYNC_POSTGRES.
//
// Incidente real que motiva este archivo: BUILD_GOLD escribía CSV nuevos,
// pero nada volvía a cargar data/warehouse/eyg_nexus.duckdb desde esos CSV
// antes de que SYNC_POSTGRES (migrate-to-supabase.js) migrara el .duckdb
// hacia Postgres - el resultado era un snapshot publicado consistente entre
// DuckDB y Postgres, pero VIEJO (ver data/reports/supabase_validation_summary.json,
// duckdb_sync_all_match=true sobre conteos desactualizados). Un simple
// "DuckDB y Postgres coinciden" nunca hubiera detectado esto - por eso las
// dos funciones de acá exigen evidencia de frescura, no solo de consistencia.
import { DuckDBInstance } from "@duckdb/node-api";
import { classifyOwnership, OWNERSHIP } from "./ownership-manifest.js";
import { DB_PATH, TABLES } from "./warehouse-config.js";

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

// loadDuckDb() (src/db/load-duckdb.js) NO lanza cuando una tabla se omite
// por CSV faltante (SKIPPED_MISSING_CSV) - correcto para su uso manual
// histórico (npm run db:duckdb:load, donde un CSV parcial a veces es
// intencional), pero dentro del orquestador cualquier tabla DUCKDB_SYNC que
// no se recargue de verdad deja el snapshot completo desactualizado sin que
// nadie lo note. Este chequeo es MÁS estricto que loadDuckDb() en sí mismo,
// a propósito, y vive separado para no tener que tocar loadDuckDb() ni
// duplicar su lógica de carga.
export function assertDuckDbLoadComplete(loadResults) {
  const problems = loadResults.filter(result => {
    if (result.status === "LOADED") return false;
    const [schema, table] = result.table.split(".");
    // Solo bloquea si la tabla es realmente obligatoria (DUCKDB_SYNC) según
    // el manifiesto - chequeo explícito en vez de asumir que TODO lo que
    // loadDuckDb() procesa siempre lo es (hoy coincide 1:1 con TABLES, pero
    // el manifiesto es la fuente de verdad real, no una coincidencia de
    // implementación).
    return classifyOwnership(schema, table).ownership === OWNERSHIP.DUCKDB_SYNC;
  });
  if (problems.length === 0) return;

  const detail = problems.map(p => `${p.table} (${p.status}${p.error ? `: ${p.error}` : ""})`).join("; ");
  throw new Error(
    `LOAD_DUCKDB: ${problems.length} tabla(s) DUCKDB_SYNC obligatoria(s) no se recargaron desde su CSV - ${detail}. ` +
    "Una tabla obligatoria nunca debe conservar en silencio el contenido de una carga anterior."
  );
}

// Mínimo exigido explícitamente por el encargo - extensible (checkKeys es un
// parámetro) sin tener que tocar el default si en el futuro se necesita
// cubrir más tablas.
export const DEFAULT_FRESHNESS_CHECK_KEYS = Object.freeze([
  "processed.fieldbeat_tasks",
  "processed.zendesk_tickets",
  "processed.dolibarr_products",
  "processed.fieldbeat_used_parts"
]);

// Relee AMBOS lados de forma independiente del propio row_count autoreportado
// por loadDuckDb(): abre su propia conexión de solo lectura sobre el .duckdb
// recién escrito y vuelve a contar cada CSV fuente aparte (read_csv_auto,
// el mismo mecanismo real de carga - nunca un conteo de líneas a mano, que
// no maneja correctamente campos con saltos de línea entre comillas).
//
// Por qué esto importa en tiempo de EJECUCIÓN, no solo en un test: si algún
// día alguien elimina la etapa LOAD_DUCKDB de scripts/pipeline/run-data-refresh.mjs,
// esta función deja de ejecutarse y SYNC_POSTGRES pierde esta última red de
// seguridad - exactamente el escenario que test/db/duckdb-freshness.test.js
// reproduce.
export async function assertDuckDbFreshAfterLoad({ dbPath = DB_PATH, tables = TABLES, checkKeys = DEFAULT_FRESHNESS_CHECK_KEYS } = {}) {
  const toCheck = tables.filter(({ schema, table }) => checkKeys.includes(`${schema}.${table}`));
  if (toCheck.length === 0) return [];

  const instance = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();
  try {
    const mismatches = [];
    for (const { schema, table, csv } of toCheck) {
      const csvCountReader = await connection.runAndReadAll(
        `SELECT COUNT(*) AS n FROM read_csv_auto(${quoteSqlLiteral(csv)}, header=true)`
      );
      const duckdbCountReader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${schema}.${table}`);
      const csvCount = Number(csvCountReader.getRowObjects()[0].n);
      const duckdbCount = Number(duckdbCountReader.getRowObjects()[0].n);
      if (csvCount !== duckdbCount) {
        mismatches.push({ table: `${schema}.${table}`, csvCount, duckdbCount });
      }
    }

    if (mismatches.length > 0) {
      const detail = mismatches.map(m => `${m.table} (CSV=${m.csvCount}, DuckDB=${m.duckdbCount})`).join("; ");
      throw new Error(
        `LOAD_DUCKDB: validación de frescura falló - el conteo del CSV construido no coincide con lo recién cargado en DuckDB para: ${detail}. ` +
        "No basta con que DuckDB y Postgres coincidan entre sí: podrían coincidir sobre un snapshot antiguo."
      );
    }

    return toCheck.map(({ schema, table }) => `${schema}.${table}`);
  } finally {
    connection.closeSync();
    // Ver el comentario equivalente en src/db/load-duckdb.js - sin esto,
    // migrateToSupabase() (que abre este mismo archivo justo después, en
    // SYNC_POSTGRES) fallaría con el archivo aún bloqueado por esta lectura.
    instance.closeSync();
  }
}
