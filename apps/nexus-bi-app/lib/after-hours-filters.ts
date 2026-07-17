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
}

function parseBooleanFlag(raw: string | null): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
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
        : undefined
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
export function buildAfterHoursMartConditions(filters: AfterHoursFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];

  if (filters.cliente) conditions.push(`${col(alias, "client_name")} = ${pusher.push(filters.cliente)}`);
  if (filters.tecnico) conditions.push(`${col(alias, "assigned_to")} = ${pusher.push(filters.tecnico)}`);
  if (filters.tipoTarea) conditions.push(`${col(alias, "task_type")} = ${pusher.push(filters.tipoTarea)}`);
  if (filters.from) conditions.push(`CAST(${col(alias, "start_time_local")} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(${col(alias, "start_time_local")} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  if (filters.confidenceLevel) conditions.push(`${col(alias, "confidence_label")} = ${pusher.push(filters.confidenceLevel)}`);
  if (filters.onlyAfterHours) conditions.push(`${col(alias, "is_after_hours_task")} = true`);
  if (filters.onlyLowConfidence) conditions.push(`${col(alias, "confidence_score")} < 65`);

  // Aditivos ETAPA 6.6C:
  if (filters.dataBasis) conditions.push(`${col(alias, "data_basis")} = ${pusher.push(filters.dataBasis)}`);
  if (filters.fallbackUsed !== undefined) conditions.push(`${col(alias, "fallback_used")} = ${pusher.push(filters.fallbackUsed)}`);
  if (filters.coverageReasonCode) conditions.push(`${col(alias, "coverage_reason_code")} = ${pusher.push(filters.coverageReasonCode)}`);
  if (filters.contractualReasonCode) conditions.push(`${col(alias, "contractual_reason_code")} = ${pusher.push(filters.contractualReasonCode)}`);

  return conditions;
}
