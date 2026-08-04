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
  // ETAPA 6.6D-FIX-1 - universo FILTRADO real (COUNT DISTINCT sobre las
  // mismas condiciones de summary, sin autoexclusión: summary aplica TODOS
  // los filtros activos, incluidos technician/client). Nunca confundir con
  // filterOptions.tecnicos.length/clientes.length (catálogo global, para
  // poblar los <select>, deliberadamente sin filtrar - ver route.ts).
  distinct_technicians: number;
  distinct_clients: number;
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
  analysis_start_time: string | null;
  analysis_end_time: string | null;
  analysis_interval_basis: "REPORTED_WORK_INTERVAL" | "DELIVERY_FALLBACK" | "TASK_TRANSITIONS" | "SCHEDULED_ESTIMATE" | "INSUFFICIENT_DATA";
  analysis_fallback_used: boolean;
  analysis_fallback_reason: string | null;
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
  // Aditivo (auditoría After-Hours, hotfix de integridad FieldBeat §5) -
  // informativo, fuente quality.fieldbeat_report_labor_summary (sql/088).
  // assigned_to sigue siendo el único responsable principal en todas las
  // columnas de horas de esta fila (duration_hours/business_hours/
  // after_hours/etc.) - este campo NUNCA reparte ni multiplica esas horas
  // por participante, solo declara cuántos participantes tiene el reporte
  // para que la fila deje de implicar silenciosamente que assigned_to es
  // la única persona que trabajó la tarea.
  participant_count: number | null;
  // Sección 14 del encargo NEXUS V3 After-Hours - modelo(s) resuelto(s) para
  // el/los equipo(s) de la tarea, MISMA precedencia estructurada
  // (processed.fieldbeat_task_equipments primero, texto como fallback
  // gobernado) que usa el detalle canónico de reporte. RESOLVED cuando hay
  // 1+ modelo distinto resuelto (2+ se listan juntos, nunca se elige uno);
  // UNKNOWN cuando no hay ninguno. Nunca AMBIGUOUS a este nivel de fila -
  // ver comentario en app/api/dashboard/after-hours/detail/route.ts.
  model: string | null;
  model_resolution_status: "RESOLVED" | "UNKNOWN";
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

// === ETAPA 6.6D - día de la semana / cruce día×hora / técnico×cliente ===

// Celda de weekday-hour: identidad compuesta (weekday, hour) que NUNCA se
// codifica en un string "key" concatenado - a diferencia de
// AfterHoursByDimensionRow (identidad simple de un único string), acá
// weekday/hour son columnas propias, tal como las devuelve
// mapWeekdayHourRow() en lib/after-hours-weekday-view.ts.
export interface AfterHoursWeekdayHourCell extends AfterHoursPopulationCounts {
  weekday: number; // ISODOW 1 (lunes) .. 7 (domingo)
  hour: number; // 0..23
  total_hours: number;
  business_hours: number;
  after_hours_total_hours: number;
  after_hours_rate: number;
  tasks_total: number;
  tasks_with_after_hours: number;
  confidence_score: number;
  confidence_label: string;
  average_confidence: number | null;
  confidence_eligible_tasks: number;
  confidence_excluded_tasks: number;
}

// `aggregationUniverseTotal`: universo de tareas bajo los mismos filtros
// PERO con la(s) dimensión(es) autoexcluida(s) de este endpoint ignoradas
// (ver lib/after-hours-filters.ts::AfterHoursFilterKey y el `exclude` de
// buildAfterHoursMartConditions) - solo coincide con
// AfterHoursSummary.total_tasks cuando ningún filtro de esa(s)
// dimensión(es) está activo. Ver invariantes de reconciliación en cada
// route.ts.
export interface AfterHoursByWeekdayResponse {
  rows: AfterHoursByDimensionRow[]; // siempre 7, orden fijo lunes->domingo, key = ISODOW como string "1".."7"
  tasksWithoutDate: number; // tareas con start_time_local NULL, dentro del mismo universo filtrado
  aggregationUniverseTotal: number;
}

export interface AfterHoursWeekdayHourResponse {
  cells: AfterHoursWeekdayHourCell[]; // siempre 168 (7x24), orden row-major fijo
  tasksWithoutDate: number;
  aggregationUniverseTotal: number;
}

export interface AfterHoursTechnicianClientResponse {
  rows: AfterHoursByDimensionRow[]; // key = técnico (assigned_to), extra = cliente (client_name)
  excludedTasks: number; // técnico y/o cliente ausentes (NULL o solo espacios) - nunca se pierden ni se duplican en rows
  aggregationUniverseTotal: number;
}
