import { createParamPusher, type ParamPusher } from "./dashboard-filters";
import { col } from "./after-hours-metrics";
import {
  AFTER_HOURS_DATA_BASIS_VALUES,
  AFTER_HOURS_COVERAGE_REASON_CODE_VALUES,
  AFTER_HOURS_CONTRACTUAL_REASON_CODE_VALUES,
  type AfterHoursDataBasis,
  type AfterHoursCoverageReasonCode,
  type AfterHoursContractualReasonCode
} from "../types/after-hours";

// Filtros de /api/dashboard/after-hours/* - ver docs/AFTER_HOURS_METRICS.md.
// Reutiliza createParamPusher de dashboard-filters.ts para no duplicar el
// manejo de placeholders $N (mismo patrón que lib/audit-sql.ts).
//
// ETAPA 6.6C: la fuente pasó de marts.fieldbeat_working_hours_analysis a
// marts.fieldbeat_working_hours_analysis_current (ver after-hours-metrics.ts
// AFTER_HOURS_VIEW). Los nombres de columna usados por los filtros
// EXISTENTES (client_name, assigned_to, task_type, start_time_local,
// confidence_label, is_after_hours_task, confidence_score) son IDÉNTICOS
// en la vista nueva (confirmado contra sql/082) - ningún filtro existente
// cambia de comportamiento. Los filtros aditivos (dataBasis/fallbackUsed/
// coverageReasonCode/contractualReasonCode) son nuevos, opcionales,
// retrocompatibles (sin ellos, el comportamiento es idéntico al de antes).
export interface AfterHoursFilters {
  from?: string;
  to?: string;
  cliente?: string;
  tecnico?: string;
  tipoTarea?: string;
  confidenceLevel?: string;
  onlyAfterHours?: boolean;
  onlyLowConfidence?: boolean;
  // Aditivos ETAPA 6.6C (§4/§7):
  dataBasis?: AfterHoursDataBasis;
  fallbackUsed?: boolean;
  coverageReasonCode?: AfterHoursCoverageReasonCode;
  contractualReasonCode?: AfterHoursContractualReasonCode;
  // Aditivos ETAPA 6.6D - día de la semana (ISODOW 1..7) y hora del día
  // (0..23), producidos por la interacción con el gráfico de día de la
  // semana y el heatmap día×hora respectivamente.
  weekday?: number;
  hour?: number;
}

// Claves de AfterHoursFilters que buildAfterHoursMartConditions() sabe
// excluir (ETAPA 6.6D, autoexclusión) - un endpoint agregado por dimensión
// X pasa X acá para no auto-colapsar su propio ranking al hacer click en
// uno de sus elementos (mismo problema ya resuelto por
// lib/dashboard-filters.ts::buildMartIdentityConditions para el dashboard
// operacional).
export type AfterHoursFilterKey =
  | "cliente"
  | "tecnico"
  | "tipoTarea"
  | "from"
  | "to"
  | "confidenceLevel"
  | "onlyAfterHours"
  | "onlyLowConfidence"
  | "dataBasis"
  | "fallbackUsed"
  | "coverageReasonCode"
  | "contractualReasonCode"
  | "weekday"
  | "hour";

function parseBooleanFlag(raw: string | null): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

// Mismo criterio laxo que el resto de los filtros: un valor fuera de rango
// o no numérico se ignora silenciosamente (nunca 400). `min`/`max` inclusive.
// OJO: el resultado puede ser 0 (hora=medianoche) - el caller NUNCA debe
// descartar un 0 con un chequeo de truthiness, solo con `=== undefined`.
function parseIntInRange(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

export function parseAfterHoursFilters(searchParams: URLSearchParams): AfterHoursFilters {
  const dataBasisRaw = searchParams.get("dataBasis");
  const coverageReasonCodeRaw = searchParams.get("coverageReasonCode");
  const contractualReasonCodeRaw = searchParams.get("contractualReasonCode");

  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    cliente: searchParams.get("client") || undefined,
    tecnico: searchParams.get("technician") || undefined,
    tipoTarea: searchParams.get("taskType") || undefined,
    confidenceLevel: searchParams.get("confidenceLevel") || undefined,
    onlyAfterHours: searchParams.get("onlyAfterHours") === "true",
    onlyLowConfidence: searchParams.get("onlyLowConfidence") === "true",
    // Valores fuera del vocabulario cerrado se ignoran (mismo criterio
    // laxo que los filtros existentes, ej. confidenceLevel nunca valida
    // contra los 4 tiers posibles tampoco) - un filtro inválido no debe
    // tumbar la request con 400, simplemente no se aplica.
    dataBasis: dataBasisRaw && (AFTER_HOURS_DATA_BASIS_VALUES as string[]).includes(dataBasisRaw) ? (dataBasisRaw as AfterHoursDataBasis) : undefined,
    fallbackUsed: parseBooleanFlag(searchParams.get("fallbackUsed")),
    coverageReasonCode:
      coverageReasonCodeRaw && (AFTER_HOURS_COVERAGE_REASON_CODE_VALUES as string[]).includes(coverageReasonCodeRaw)
        ? (coverageReasonCodeRaw as AfterHoursCoverageReasonCode)
        : undefined,
    contractualReasonCode:
      contractualReasonCodeRaw && (AFTER_HOURS_CONTRACTUAL_REASON_CODE_VALUES as string[]).includes(contractualReasonCodeRaw)
        ? (contractualReasonCodeRaw as AfterHoursContractualReasonCode)
        : undefined,
    // Aditivos ETAPA 6.6D: weekday (ISODOW 1..7), hour (0..23). `hour=0`
    // (medianoche) es un valor legítimo - parseIntInRange devuelve 0, nunca
    // undefined, para ese caso.
    weekday: parseIntInRange(searchParams.get("weekday"), 1, 7),
    hour: parseIntInRange(searchParams.get("hour"), 0, 23)
  };
}

export { createParamPusher, type ParamPusher };

// Condiciones sobre marts.fieldbeat_working_hours_analysis_current (alias
// "w" por convención en los endpoints de after-hours). onlyLowConfidence
// usa el mismo umbral (<65, límite Baja/Media) que la advertencia "Cálculo
// preliminar" en MetricCardWithConfidence.tsx - en Postgres,
// `confidence_score < 65` con confidence_score NULL evalúa a NULL (falsy
// en WHERE), así que las filas NULL quedan excluidas automáticamente, sin
// necesidad de un `IS NOT NULL` explícito adicional.
/**
 * @param exclude claves de filtro a IGNORAR al construir condiciones -
 * autoexclusión (ETAPA 6.6D): un endpoint agregado por dimensión X pasa X
 * acá para que seleccionar un elemento de su propio ranking no lo
 * auto-colapse (mismo patrón que buildMartIdentityConditions en
 * lib/dashboard-filters.ts). Default [] = comportamiento idéntico al de
 * antes de 6.6D (regresión cubierta por test).
 */
export function buildAfterHoursMartConditions(filters: AfterHoursFilters, alias: string, pusher: ParamPusher, exclude: AfterHoursFilterKey[] = []): string[] {
  const skip = new Set(exclude);
  const conditions: string[] = [];

  if (!skip.has("cliente") && filters.cliente) conditions.push(`${col(alias, "client_name")} = ${pusher.push(filters.cliente)}`);
  if (!skip.has("tecnico") && filters.tecnico) conditions.push(`${col(alias, "assigned_to")} = ${pusher.push(filters.tecnico)}`);
  if (!skip.has("tipoTarea") && filters.tipoTarea) conditions.push(`${col(alias, "task_type")} = ${pusher.push(filters.tipoTarea)}`);
  if (!skip.has("from") && filters.from) conditions.push(`CAST(${col(alias, "start_time_local")} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (!skip.has("to") && filters.to) conditions.push(`CAST(${col(alias, "start_time_local")} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  if (!skip.has("confidenceLevel") && filters.confidenceLevel) conditions.push(`${col(alias, "confidence_label")} = ${pusher.push(filters.confidenceLevel)}`);
  if (!skip.has("onlyAfterHours") && filters.onlyAfterHours) conditions.push(`${col(alias, "is_after_hours_task")} = true`);
  if (!skip.has("onlyLowConfidence") && filters.onlyLowConfidence) conditions.push(`${col(alias, "confidence_score")} < 65`);

  // Aditivos ETAPA 6.6C:
  if (!skip.has("dataBasis") && filters.dataBasis) conditions.push(`${col(alias, "data_basis")} = ${pusher.push(filters.dataBasis)}`);
  if (!skip.has("fallbackUsed") && filters.fallbackUsed !== undefined) conditions.push(`${col(alias, "fallback_used")} = ${pusher.push(filters.fallbackUsed)}`);
  if (!skip.has("coverageReasonCode") && filters.coverageReasonCode) conditions.push(`${col(alias, "coverage_reason_code")} = ${pusher.push(filters.coverageReasonCode)}`);
  if (!skip.has("contractualReasonCode") && filters.contractualReasonCode) conditions.push(`${col(alias, "contractual_reason_code")} = ${pusher.push(filters.contractualReasonCode)}`);

  // Aditivos ETAPA 6.6D - día de la semana / hora del día. `hour` usa
  // `!== undefined` (nunca truthy): hour=0 (medianoche) es un valor válido
  // que una comprobación truthy descartaría por error.
  if (!skip.has("weekday") && filters.weekday !== undefined) conditions.push(`EXTRACT(ISODOW FROM ${col(alias, "start_time_local")}) = ${pusher.push(filters.weekday)}`);
  if (!skip.has("hour") && filters.hour !== undefined) conditions.push(`EXTRACT(HOUR FROM ${col(alias, "start_time_local")}) = ${pusher.push(filters.hour)}`);

  return conditions;
}
