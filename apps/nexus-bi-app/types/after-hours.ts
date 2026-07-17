// Formas de request/response de /api/dashboard/after-hours/* - ver
// docs/AFTER_HOURS_METRICS.md y docs/CALCULATION_CONFIDENCE_MODEL.md.
// ETAPA 6.6C: fuente ahora es marts.fieldbeat_working_hours_analysis_current
// (nunca el mart legado directo, nunca Capa B/C directo). Todo lo que
// aparece acá viene precomputado por el pipeline (working-hours builder,
// ETAPA 6.6B2), nunca recalculado en la app.
//
// Vocabularios cerrados: mirror deliberado de
// src/working-hours/coverage-reason-codes.js (mismo patrón que
// lib/confidence.ts mirrorea src/lib/calculation-confidence.js) - la app
// Next.js no importa código de src/ para no arrastrar dependencias nativas
// al bundle serverless (ver nota en lib/api-error.ts). Mantener sincronizado
// a mano si cambia el vocabulario fuente.

export type AfterHoursDataBasis = "CONTRACTUAL" | "LEGACY_SCHEDULE" | "NONE";

export type AfterHoursCoverageClassification = "FULLY_COVERED" | "PARTIALLY_COVERED" | "NOT_COVERED" | "NOT_CALCULABLE";

export type AfterHoursCalculationStatus = "CALCULATED" | "CALCULATED_WITH_WARNINGS" | "NOT_CALCULABLE";

export type AfterHoursContractualAttemptStatus = "CALCULATED" | "NOT_CALCULABLE";

// 17 códigos de Capa C (coverage_reason_code) - incluye WITHIN_LEGACY_SCHEDULE.
export type AfterHoursCoverageReasonCode =
  | "WITHIN_MATCHED_CONTRACT"
  | "WITHIN_LEGACY_SCHEDULE"
  | "MULTIPLE_EQUIPMENT_SAME_COVERAGE"
  | "MULTIPLE_EQUIPMENT_CONFLICT"
  | "NO_EQUIPMENT"
  | "EQUIPMENT_UNMATCHED"
  | "EQUIPMENT_AMBIGUOUS"
  | "NO_CONTRACT_AT_TASK_DATE"
  | "NO_CONTRACT_STATUS"
  | "ON_DEMAND_UNDEFINED"
  | "CONTRACT_STATUS_DEINSTALLED"
  | "SCHEDULE_REVIEW_REQUIRED"
  | "CRITICALITY_UNKNOWN"
  | "HOLIDAY_COVERAGE_UNKNOWN"
  | "INVALID_START_TIME"
  | "INVALID_DURATION"
  | "INSUFFICIENT_DATA";

// contractual_reason_code nunca incluye WITHIN_LEGACY_SCHEDULE (eso es un
// resultado del fallback, nunca del intento contractual en sí) - 16 valores.
export type AfterHoursContractualReasonCode = Exclude<AfterHoursCoverageReasonCode, "WITHIN_LEGACY_SCHEDULE">;

export const AFTER_HOURS_DATA_BASIS_VALUES: readonly AfterHoursDataBasis[] = ["CONTRACTUAL", "LEGACY_SCHEDULE", "NONE"];

export const AFTER_HOURS_COVERAGE_REASON_CODE_VALUES: readonly AfterHoursCoverageReasonCode[] = [
  "WITHIN_MATCHED_CONTRACT",
  "WITHIN_LEGACY_SCHEDULE",
  "MULTIPLE_EQUIPMENT_SAME_COVERAGE",
  "MULTIPLE_EQUIPMENT_CONFLICT",
  "NO_EQUIPMENT",
  "EQUIPMENT_UNMATCHED",
  "EQUIPMENT_AMBIGUOUS",
  "NO_CONTRACT_AT_TASK_DATE",
  "NO_CONTRACT_STATUS",
  "ON_DEMAND_UNDEFINED",
  "CONTRACT_STATUS_DEINSTALLED",
  "SCHEDULE_REVIEW_REQUIRED",
  "CRITICALITY_UNKNOWN",
  "HOLIDAY_COVERAGE_UNKNOWN",
  "INVALID_START_TIME",
  "INVALID_DURATION",
  "INSUFFICIENT_DATA"
];

export const AFTER_HOURS_CONTRACTUAL_REASON_CODE_VALUES: readonly AfterHoursContractualReasonCode[] =
  AFTER_HOURS_COVERAGE_REASON_CODE_VALUES.filter((c): c is AfterHoursContractualReasonCode => c !== "WITHIN_LEGACY_SCHEDULE");

// === Poblaciones (ETAPA 6.6C §5/§8/§9) - definidas una sola vez, reusadas
// en summary y en los 4 endpoints agregados. ===
export interface AfterHoursPopulationCounts {
  total_tasks: number;
  calculable_tasks: number;
  not_calculable_tasks: number;
  contractual_tasks: number;
  legacy_schedule_tasks: number;
  none_tasks: number;
  fallback_tasks: number;
}

// === Campos contractuales aditivos (§4) - compartidos entre detail y,
// donde aplique, otros endpoints. ===
export interface AfterHoursContractualFields {
  data_basis: AfterHoursDataBasis;
  fallback_used: boolean | null;
  coverage_classification: AfterHoursCoverageClassification | null;
  coverage_reason_code: AfterHoursCoverageReasonCode | null;
  contractual_attempt_status: AfterHoursContractualAttemptStatus | null;
  contractual_coverage_classification: AfterHoursCoverageClassification | null;
  contractual_reason_code: AfterHoursContractualReasonCode | null;
  contract_resolution_confidence: number | null;
  contract_resolution_label: string | null;
  confidence_model_version: string | null;
  primary_equipment_key: string | null;
}

export interface MetricWithConfidence<T> {
  value: T;
  confidence_score: number;
  confidence_label: string;
  confidence_factors_summary?: string;
}

export interface AfterHoursSummary extends AfterHoursPopulationCounts {
  businessHoursStatus: string;
  holidaysStatus: string;
  filterOptions: {
    clientes: string[];
    tecnicos: string[];
    tiposTarea: string[];
    // Aditivos §8:
    dataBases: AfterHoursDataBasis[];
    coverageReasonCodes: AfterHoursCoverageReasonCode[];
    contractualReasonCodes: AfterHoursContractualReasonCode[];
  };
  kpis: {
    totalHours: MetricWithConfidence<number>;
    businessHours: MetricWithConfidence<number>;
    afterHoursHours: MetricWithConfidence<number>;
    afterHoursRate: MetricWithConfidence<number>;
    tasksWithAfterHours: MetricWithConfidence<number>;
    tasksNotCalculable: MetricWithConfidence<number>;
  };
  // Distribución aditiva por data_basis (§6.1) - evita que el consumidor
  // interprete business_minutes como si fuera siempre contractual.
  byDataBasis: Array<{ data_basis: AfterHoursDataBasis; task_count: number; business_minutes: number | null }>;
  confidence_eligible_tasks: number;
  confidence_excluded_tasks: number;
}

export interface AfterHoursDetailRow extends AfterHoursContractualFields {
  fieldbeat_task_id: number;
  start_time: string | null;
  estimated_end_time: string | null; // nombre de campo JSON preservado por compatibilidad; la columna SQL fuente ahora es end_time_local (antes estimated_end_time_local), ver §6.4
  reported_end_raw: string | null;
  calculation_method: string;
  client_name: string | null;
  equipment_internal_ids: string | null;
  assigned_to: string | null;
  task_type: string | null;
  duration_hours: number | null;
  business_hours: number | null;
  after_hours: number | null;
  weekend_hours: number | null;
  holiday_hours: number | null;
  after_hours_rate: number | null;
  calculation_status: AfterHoursCalculationStatus;
  confidence_score: number | null;
  confidence_label: string | null;
  confidence_factors: string | null;
}

export interface AfterHoursByDimensionRow extends AfterHoursPopulationCounts {
  key: string;
  extra?: string | null;
  total_hours: number;
  business_hours: number;
  after_hours_total_hours: number;
  after_hours_rate: number;
  tasks_total: number; // preservado por compatibilidad, idéntico a total_tasks
  tasks_with_after_hours: number;
  confidence_score: number;
  confidence_label: string;
  // Aditivos §9:
  average_confidence: number | null;
  confidence_eligible_tasks: number;
  confidence_excluded_tasks: number;
}

export interface ConfidenceDistributionRow {
  confidence_label: string;
  task_count: number;
}

// Distribución aditiva de contract_resolution_confidence, EXCLUSIVAMENTE
// para data_basis=CONTRACTUAL - nunca se mezcla con confidence_score en la
// misma serie (§10, escalas distintas, semántica distinta).
export interface ContractResolutionDistributionRow {
  contract_resolution_label: string;
  task_count: number;
}

export interface ConfidenceDistributionResponse {
  rows: ConfidenceDistributionRow[];
  noneWithoutScore: number; // filas NONE sin score, reportadas aparte, nunca como "Insuficiente"
  contractResolutionDistribution: ContractResolutionDistributionRow[];
}
