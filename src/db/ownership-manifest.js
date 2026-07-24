// Contrato central de ownership para migración y validación PostgreSQL.
// Ningún caller mantiene su propia allowlist: warehouse-config.js::TABLES
// aporta DUCKDB_SYNC y este módulo registra todas las excepciones/objetos
// Postgres-native. Un objeto ausente del manifiesto es UNKNOWN (known=false),
// nunca EXTERNAL implícito: el migrador lo omite y el validador lo diagnostica.

import { TABLES } from "./warehouse-config.js";

export const OWNERSHIP = Object.freeze({
  DUCKDB_SYNC: "DUCKDB_SYNC",
  EXTERNAL: "EXTERNAL",
  POSTGRES_BUILDER: "POSTGRES_BUILDER",
  POSTGRES_TRANSACTIONAL: "POSTGRES_TRANSACTIONAL",
  VIEW_NOT_APPLICABLE: "VIEW_NOT_APPLICABLE"
});

function key(schema, name) {
  return `${schema}.${name}`;
}

function entry(schema, name, ownership, options = {}) {
  return Object.freeze({
    key: key(schema, name),
    schema,
    name,
    kind: options.kind ?? "table",
    ownership,
    requiredColumns: Object.freeze([...(options.requiredColumns ?? [])])
  });
}

const DUCKDB_SYNC_ENTRIES = TABLES.map(({ schema, table }) =>
  entry(schema, table, OWNERSHIP.DUCKDB_SYNC)
);

// Objetos existentes en el warehouse histórico pero sin generador vigente.
// La lista explícita evita confundir drift desconocido con deuda conocida.
const EXTERNAL_ENTRIES = [
  entry("marts", "equipment_part_lifecycle_events", OWNERSHIP.EXTERNAL),
  entry("marts", "equipment_part_lifecycle_intervals", OWNERSHIP.EXTERNAL),
  entry("marts", "fieldbeat_working_hours_analysis", OWNERSHIP.EXTERNAL),
  entry("gold", "after_hours_by_client", OWNERSHIP.EXTERNAL),
  entry("gold", "after_hours_by_period", OWNERSHIP.EXTERNAL),
  entry("gold", "after_hours_by_task_type", OWNERSHIP.EXTERNAL),
  entry("gold", "after_hours_by_technician", OWNERSHIP.EXTERNAL),
  entry("gold", "after_hours_work_analysis", OWNERSHIP.EXTERNAL),
  entry("gold", "equipment_part_lifecycle_by_client", OWNERSHIP.EXTERNAL),
  entry("gold", "equipment_part_lifecycle_by_machine", OWNERSHIP.EXTERNAL),
  entry("gold", "equipment_part_lifecycle_by_part", OWNERSHIP.EXTERNAL),
  entry("gold", "equipment_part_lifecycle_insights", OWNERSHIP.EXTERNAL),
  entry("gold", "equipment_part_lifecycle_summary", OWNERSHIP.EXTERNAL)
];

const POSTGRES_BUILDER_ENTRIES = [
  entry("marts", "fieldbeat_contract_coverage_segments", OWNERSHIP.POSTGRES_BUILDER, {
    requiredColumns: ["segment_id", "fieldbeat_task_id", "segment_start_utc", "segment_end_utc", "builder_run_id"]
  }),
  entry("marts", "fieldbeat_working_hours_analysis_v2", OWNERSHIP.POSTGRES_BUILDER, {
    requiredColumns: ["working_hours_id", "fieldbeat_task_id", "calculation_status", "data_basis", "builder_run_id"]
  }),
  entry("marts", "fieldbeat_working_hours_equipment_links", OWNERSHIP.POSTGRES_BUILDER, {
    requiredColumns: ["link_id", "working_hours_id", "fieldbeat_equipment_key", "is_primary"]
  })
];

const POSTGRES_TRANSACTIONAL_ENTRIES = [
  entry("audit", "pipeline_runs", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("audit", "data_quality_events", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("audit", "warehouse_sync_state", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("manual_review", "part_aliases", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("manual_review", "ticket_link_overrides", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("manual_review", "contract_data_issues", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("stock", "stock_movements", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_import_runs", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_source_rows", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_equipment_versions", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_equipment_observations", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_service_schedules", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_service_windows", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_equipment_matches", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "contract_equipment_match_overrides", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "holiday_import_runs", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "holiday_calendar_entries", OWNERSHIP.POSTGRES_TRANSACTIONAL),
  entry("config", "holiday_calendar_coverage", OWNERSHIP.POSTGRES_TRANSACTIONAL)
];

const VIEW_ENTRIES = [
  entry("marts", "fieldbeat_working_hours_analysis_current", OWNERSHIP.VIEW_NOT_APPLICABLE, { kind: "view" }),
  entry("config", "current_holiday_calendar_entries", OWNERSHIP.VIEW_NOT_APPLICABLE, { kind: "view" }),
  entry("config", "current_holiday_calendar_coverage", OWNERSHIP.VIEW_NOT_APPLICABLE, { kind: "view" }),
  entry("config", "contract_equipment_analysis", OWNERSHIP.VIEW_NOT_APPLICABLE, { kind: "view" }),
  entry("config", "contract_service_window_analysis", OWNERSHIP.VIEW_NOT_APPLICABLE, { kind: "view" })
];

const ENTRIES = Object.freeze([
  ...DUCKDB_SYNC_ENTRIES,
  ...EXTERNAL_ENTRIES,
  ...POSTGRES_BUILDER_ENTRIES,
  ...POSTGRES_TRANSACTIONAL_ENTRIES,
  ...VIEW_ENTRIES
]);

export function assertUniqueOwnershipEntries(entries) {
  const seen = new Set();
  for (const item of entries) {
    const identity = `${item.kind}:${item.key}`;
    if (seen.has(identity)) {
      throw new Error(`Contrato de ownership duplicado para ${identity}. Cada objeto debe pertenecer a una sola categoría.`);
    }
    seen.add(identity);
  }
}

assertUniqueOwnershipEntries(ENTRIES);

const ENTRY_BY_KIND_AND_KEY = new Map(
  ENTRIES.map(item => [`${item.kind}:${item.key}`, item])
);

export const VIEWS_NOT_APPLICABLE = Object.freeze(
  VIEW_ENTRIES.map(item => item.key)
);

export function classifyOwnership(schema, name, kind = "table") {
  const objectKey = key(schema, name);
  const knownEntry = ENTRY_BY_KIND_AND_KEY.get(`${kind}:${objectKey}`);
  if (knownEntry) return { ...knownEntry, known: true };

  return {
    key: objectKey,
    schema,
    name,
    kind,
    known: false,
    ownership: null,
    requiredColumns: []
  };
}

export function listOwnershipEntries(filters = {}) {
  return ENTRIES
    .filter(item => !filters.ownership || item.ownership === filters.ownership)
    .filter(item => !filters.kind || item.kind === filters.kind)
    .map(item => ({ ...item, requiredColumns: [...item.requiredColumns] }));
}

export function getOwnership(schema, name, kind = "table") {
  return classifyOwnership(schema, name, kind).ownership;
}

export function isDuckdbSync(schema, table) {
  return classifyOwnership(schema, table).ownership === OWNERSHIP.DUCKDB_SYNC;
}
