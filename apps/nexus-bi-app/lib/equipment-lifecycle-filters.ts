import { createParamPusher, type ParamPusher } from "./dashboard-filters";
import { appendFilterCondition, buildSearchCondition, isAllFilter, normalizeFilterValue } from "./filter-utils";

// Filtros de /api/dashboard/equipment-lifecycle/* - ver
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md y
// docs/LIFECYCLE_PREDICTIVE_MODELS.md. Reutiliza createParamPusher de
// dashboard-filters.ts y los helpers genéricos de filter-utils.ts (para
// que la opción "Todos" nunca llegue al SQL como valor literal).
export interface EquipmentLifecycleFilters {
  client?: string;
  equipment?: string;
  dolibarrRef?: string;
  partName?: string;
  confidenceLevel?: string;
  estimateStatus?: string;
  model?: string; // selected_model (ver lifecycle-model-selector.js) - "Auto recomendado" = sin filtro
  taskType?: string;
  from?: string;
  to?: string;
  q?: string;
  onlyReliable?: boolean;
  onlyInsufficientData?: boolean;
}

export function parseEquipmentLifecycleFilters(searchParams: URLSearchParams): EquipmentLifecycleFilters {
  return {
    client: normalizeFilterValue(searchParams.get("client")),
    equipment: normalizeFilterValue(searchParams.get("equipment")),
    dolibarrRef: normalizeFilterValue(searchParams.get("dolibarrRef")),
    partName: normalizeFilterValue(searchParams.get("partName")),
    confidenceLevel: normalizeFilterValue(searchParams.get("confidenceLevel")),
    estimateStatus: normalizeFilterValue(searchParams.get("estimateStatus")),
    model: normalizeFilterValue(searchParams.get("model")),
    taskType: normalizeFilterValue(searchParams.get("taskType")),
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    q: searchParams.get("q")?.trim() || undefined,
    onlyReliable: searchParams.get("onlyReliable") === "true",
    onlyInsufficientData: searchParams.get("onlyInsufficientData") === "true"
  };
}

export { createParamPusher, type ParamPusher };

const RELIABLE_SCORE_THRESHOLD = 65;

// Columnas de búsqueda libre por grano de tabla (ver
// lib/filter-utils.ts::buildSearchCondition) - solo las que existen
// realmente a cada nivel de agregación.
export const AGGREGATE_SEARCH_COLUMNS = ["client_name", "equipment_internal_id", "dolibarr_ref", "dolibarr_label"];
// "CAST:" castea la columna a VARCHAR antes del ILIKE - fieldbeat_task_id
// y linked_zendesk_ticket_id son numéricos en DuckDB (BIGINT), ILIKE
// exige VARCHAR en ambos lados.
export const EVENT_SEARCH_COLUMNS = [
  "client_name", "equipment_internal_id", "equipment_uuid", "dolibarr_ref", "dolibarr_label",
  "part_name", "raw_part_identifier", "task_type", "technician_names", "CAST:fieldbeat_task_id", "CAST:linked_zendesk_ticket_id"
];
export const INSIGHTS_SEARCH_COLUMNS = ["equipment_internal_id", "dolibarr_ref", "insight_text"];

// Condiciones sobre gold.equipment_part_lifecycle_by_{machine,client,part} -
// las 3 tablas comparten el mismo shape de columnas de confiabilidad/estimación
// (ver computeGroupMetrics en src/gold/build-equipment-part-lifecycle-gold.js).
// `hasEquipmentColumn`/`hasClientColumn` desactivan filtros que no aplican a
// by_client (sin equipment_internal_id) ni a by_part (sin equipment_internal_id
// ni client_name).
export function buildLifecycleAggregateConditions(
  filters: EquipmentLifecycleFilters,
  alias: string,
  pusher: ParamPusher,
  options: { hasEquipmentColumn?: boolean; hasClientColumn?: boolean } = {}
): string[] {
  const { hasEquipmentColumn = true, hasClientColumn = true } = options;
  const conditions: string[] = [];

  if (hasClientColumn) appendFilterCondition(conditions, "client_name", filters.client, pusher, alias);
  if (hasEquipmentColumn) appendFilterCondition(conditions, "equipment_internal_id", filters.equipment, pusher, alias);
  appendFilterCondition(conditions, "dolibarr_ref", filters.dolibarrRef, pusher, alias);
  appendFilterCondition(conditions, "estimate_status", filters.estimateStatus, pusher, alias);
  appendFilterCondition(conditions, "selected_model", filters.model, pusher, alias);

  if (!isAllFilter(filters.partName)) {
    const col = alias ? `${alias}.dolibarr_label` : "dolibarr_label";
    conditions.push(`${col} ILIKE ${pusher.push(`%${normalizeFilterValue(filters.partName)}%`)}`);
  }
  if (!isAllFilter(filters.confidenceLevel)) {
    const col = alias ? `${alias}.lifecycle_confidence_label` : "lifecycle_confidence_label";
    conditions.push(`${col} = ${pusher.push(normalizeFilterValue(filters.confidenceLevel)!)}`);
  }
  if (filters.onlyReliable) {
    const col = alias ? `${alias}.lifecycle_confidence_score` : "lifecycle_confidence_score";
    conditions.push(`${col} >= ${RELIABLE_SCORE_THRESHOLD}`);
  }
  if (filters.onlyInsufficientData) {
    const col = alias ? `${alias}.estimate_status` : "estimate_status";
    conditions.push(`${col} = 'INSUFFICIENT_DATA'`);
  }

  // Solo busca en las columnas que existen realmente en la tabla que se
  // está consultando (by_client/by_part no tienen equipment_internal_id,
  // by_part tampoco tiene client_name - ver hasEquipmentColumn/hasClientColumn).
  const searchColumns = AGGREGATE_SEARCH_COLUMNS.filter(column => {
    if (column === "equipment_internal_id") return hasEquipmentColumn;
    if (column === "client_name") return hasClientColumn;
    return true;
  });
  const searchCondition = buildSearchCondition(filters.q, searchColumns, pusher, alias);
  if (searchCondition) conditions.push(searchCondition);

  return conditions;
}

// Condiciones sobre marts.equipment_part_lifecycle_events - tabla de detalle
// (grano evento individual, no agregado por máquina/repuesto).
export function buildLifecycleEventConditions(filters: EquipmentLifecycleFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];

  appendFilterCondition(conditions, "client_name", filters.client, pusher, alias);
  appendFilterCondition(conditions, "equipment_internal_id", filters.equipment, pusher, alias);
  appendFilterCondition(conditions, "dolibarr_ref", filters.dolibarrRef, pusher, alias);
  appendFilterCondition(conditions, "task_type", filters.taskType, pusher, alias);
  appendFilterCondition(conditions, "association_confidence_label", filters.confidenceLevel, pusher, alias);

  if (!isAllFilter(filters.partName)) {
    const value = normalizeFilterValue(filters.partName)!;
    const partCol = alias ? `${alias}.part_name` : "part_name";
    const labelCol = alias ? `${alias}.dolibarr_label` : "dolibarr_label";
    const placeholder = pusher.push(`%${value}%`);
    conditions.push(`(${partCol} ILIKE ${placeholder} OR ${labelCol} ILIKE ${placeholder})`);
  }
  if (filters.from) {
    const col = alias ? `${alias}.event_date` : "event_date";
    conditions.push(`CAST(${col} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  }
  if (filters.to) {
    const col = alias ? `${alias}.event_date` : "event_date";
    conditions.push(`CAST(${col} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  }
  if (filters.onlyReliable) {
    const matchCol = alias ? `${alias}.match_status` : "match_status";
    const statusCol = alias ? `${alias}.calculation_status` : "calculation_status";
    conditions.push(`${matchCol} = 'MATCHED' AND ${statusCol} = 'OK'`);
  }

  const searchCondition = buildSearchCondition(filters.q, EVENT_SEARCH_COLUMNS, pusher, alias);
  if (searchCondition) conditions.push(searchCondition);

  return conditions;
}
