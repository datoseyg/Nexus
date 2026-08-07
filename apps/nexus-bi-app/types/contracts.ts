// Bloque 2 (NEXUS V3 - filtro de Cliente en Contratos + horario de
// cobertura contractual). Tipos NEUTRALES de dominio contractual - viven
// acá (no en types/fieldbeat-report-detail.ts) porque la dependencia
// correcta es "FieldBeat report detail -> tipos de contratos", nunca al
// revés (FieldbeatContractRelation importa ContractScheduleResult de este
// archivo, no el camino inverso).

/** Refleja DIRECTAMENTE los valores reales de
 * config.contract_service_schedules.coverage_type (CHECK constraint,
 * sql/070_config.sql) - sin un segundo enum simplificado en paralelo que
 * pudiera divergir silenciosamente si el CHECK real cambia. */
export type ContractCoverageType =
  | "FULL_24X7"
  | "CRITICAL_ONLY_24X7"
  | "FIXED_WINDOW"
  | "BUSINESS_HOURS_UNDEFINED"
  | "ON_DEMAND"
  | "NOT_COVERED"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

/** Valores literales confirmados contra el CHECK real de
 * config.contract_service_windows.day_of_week (sql/070_config.sql) - no un
 * supuesto. */
export type ContractDayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface ContractServiceWindow {
  dayOfWeek: ContractDayOfWeek;
  dayLabel: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  includesHolidays: boolean;
}

/**
 * Horario de cobertura contractual de UNA versión de contrato puntual
 * (contract_version_id) - nunca "el horario vigente del equipo", una
 * versión histórica trae su propio schedule y su propia vigencia
 * (effectiveFrom/effectiveTo), nunca la de la versión actual.
 *
 * coversWeekends/coversHolidays son `boolean | null` a propósito - `null`
 * cuando no hay ventanas de las que derivarlo (BUSINESS_HOURS_UNDEFINED/
 * ON_DEMAND/NOT_COVERED/NOT_APPLICABLE/UNKNOWN); nunca se asume `false` por
 * ausencia de datos (eso inventaría una afirmación que el contrato no hace).
 */
export interface ContractCoverageSchedule {
  timezone: string;
  coverageType: ContractCoverageType;
  parseStatus: "OK" | "REVIEW_REQUIRED";
  /** Lun->Dom (ContractDayOfWeek), nunca alfabético - orden real ya aplicado
   * por mapServiceWindowRowsToCoverageSchedule() (lib/contract-coverage-schedule.ts),
   * único lugar donde se ordena. */
  windows: ContractServiceWindow[];
  coversWeekends: boolean | null;
  coversHolidays: boolean | null;
  /** De la VERSIÓN exacta (contract_equipment_versions.valid_from de ESE
   * contract_version_id), nunca "la vigente actual" del equipo. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  resolutionSource: "config.contract_service_schedules";
}

/**
 * Resultado discriminado de resolver el schedule de un contract_version_id -
 * nunca `ContractCoverageSchedule | null` + un boolean de error suelto
 * (mismo principio que FieldbeatIssuesAvailability en
 * types/fieldbeat-report-detail.ts: una unión discriminada explícita, no un
 * nullable ambiguo).
 *
 * AVAILABLE - existe una fila en contract_service_schedules para esta
 *   versión y se consultó correctamente (incluye el caso legítimo de cero
 *   ventanas: FULL_24X7/CRITICAL_ONLY_24X7/BUSINESS_HOURS_UNDEFINED/etc.).
 * MISSING - se consultó correctamente y NO existe fila de schedule para
 *   esta versión (config.contract_service_schedules es 1:1 opcional con
 *   contract_version_id, no siempre existe).
 * UNAVAILABLE - la consulta falló; no se pudo verificar. Nunca se confunde
 *   con MISSING (uno es "no hay horario", el otro es "no sabemos").
 */
export type ContractScheduleResult =
  | { status: "AVAILABLE"; schedule: ContractCoverageSchedule }
  | { status: "MISSING"; schedule: null }
  | { status: "UNAVAILABLE"; schedule: null };
