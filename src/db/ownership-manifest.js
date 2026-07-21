// Manifiesto de ownership -4 categorías que determinan qué puede tocar
// src/db/migrate-to-supabase.js. Derivado de warehouse-config.js::TABLES
// (esa lista ES la prueba de "tiene generador DuckDB real") con overrides
// explícitos encima, en vez de mantener dos listas paralelas que puedan
// divergir.
//
// DUCKDB_SYNC          -tabla real en warehouse-config.js::TABLES, sin
//                        override -único caso que migrate-to-supabase.js
//                        puede sincronizar (TRUNCATE+INSERT).
// POSTGRES_BUILDER      -escrita por un builder Postgres-nativo (Capa B/C de
//                        ETAPA 6.6, src/contracts/**) -nunca pasa por DuckDB.
// POSTGRES_TRANSACTIONAL -tablas de config.*/manual_review.*/audit.*/stock.*
//                        -ya protegidas hoy por el filtro de schema de
//                        SYNC_SCHEMAS; la entrada acá es documentación /
//                        defensa en profundidad, no el mecanismo primario.
// EXTERNAL              -existe físicamente en el .duckdb (o podría
//                        aparecer ahí) pero NO tiene generador real en esta
//                        rama -ej. marts.fieldbeat_working_hours_analysis,
//                        un snapshot congelado horneado una vez
//                        (docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md). Debe
//                        excluirse explícitamente aunque el descubrimiento
//                        por schema lo encontraría.

import { TABLES } from "./warehouse-config.js";

export const OWNERSHIP = Object.freeze({
  DUCKDB_SYNC: "DUCKDB_SYNC",
  POSTGRES_BUILDER: "POSTGRES_BUILDER",
  POSTGRES_TRANSACTIONAL: "POSTGRES_TRANSACTIONAL",
  EXTERNAL: "EXTERNAL"
});

function key(schema, table) {
  return `${schema}.${table}`;
}

// Gana sobre la clasificación derivada de TABLES -único mecanismo para
// declarar una excepción como el mart legado (existe en el .duckdb por
// haber sido horneado ahí una vez, pero ningún script de esta rama lo
// genera ni en DuckDB ni en Postgres).
const EXPLICIT_OVERRIDES = Object.freeze({
  [key("marts", "fieldbeat_working_hours_analysis")]: OWNERSHIP.EXTERNAL
});

// Tablas que NUNCA aparecen en TABLES (Postgres-nativas, sin CSV/DuckDB) -
// Capa B/C de ETAPA 6.6B0 y config.*/manual_review.* de ETAPA 6.5/6.6.
const POSTGRES_NATIVE = Object.freeze({
  [key("marts", "fieldbeat_contract_coverage_segments")]: OWNERSHIP.POSTGRES_BUILDER,
  [key("marts", "fieldbeat_working_hours_analysis_v2")]: OWNERSHIP.POSTGRES_BUILDER,
  [key("marts", "fieldbeat_working_hours_equipment_links")]: OWNERSHIP.POSTGRES_BUILDER,

  [key("config", "contract_import_runs")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_source_rows")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_equipment_versions")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_equipment_observations")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_service_schedules")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_service_windows")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_equipment_matches")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "contract_equipment_match_overrides")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "holiday_import_runs")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "holiday_calendar_entries")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("config", "holiday_calendar_coverage")]: OWNERSHIP.POSTGRES_TRANSACTIONAL,
  [key("manual_review", "contract_data_issues")]: OWNERSHIP.POSTGRES_TRANSACTIONAL
});

// Nota explícita (no una entrada categorizada): las vistas nunca se
// sincronizan -migrate-to-supabase.js opera sobre information_schema.tables
// del catálogo DuckDB adjunto, donde una vista Postgres-nativa como
// marts.fieldbeat_working_hours_analysis_current nunca existe. No hace
// falta clasificarla; se documenta acá para que quede registrado por qué.
export const VIEWS_NOT_APPLICABLE = Object.freeze(["marts.fieldbeat_working_hours_analysis_current", "config.current_holiday_calendar_entries", "config.current_holiday_calendar_coverage"]);

const registeredDuckdbTables = new Set(TABLES.map(t => key(t.schema, t.table)));

/**
 * @param {string} schema
 * @param {string} table
 * @returns {string} uno de OWNERSHIP
 */
export function getOwnership(schema, table) {
  const k = key(schema, table);
  if (k in EXPLICIT_OVERRIDES) return EXPLICIT_OVERRIDES[k];
  if (registeredDuckdbTables.has(k)) return OWNERSHIP.DUCKDB_SYNC;
  if (k in POSTGRES_NATIVE) return POSTGRES_NATIVE[k];
  // No reconocida en ningún inventario -tratada como EXTERNAL (desconocida),
  // nunca sincronizada por accidente. Preferible a asumir DUCKDB_SYNC por
  // default.
  return OWNERSHIP.EXTERNAL;
}

/**
 * @param {string} schema
 * @param {string} table
 * @returns {boolean} true si y solo si migrate-to-supabase.js puede
 *   sincronizar esta tabla (TRUNCATE+INSERT) desde el .duckdb
 */
export function isDuckdbSync(schema, table) {
  return getOwnership(schema, table) === OWNERSHIP.DUCKDB_SYNC;
}
