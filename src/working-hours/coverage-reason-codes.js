// Vocabulario cerrado de razones de (no)calculabilidad para la arquitectura
// contractual de "Trabajo Fuera de Horario" (ETAPA 6.6B0). Cada array debe
// coincidir 1:1, valor por valor, con el CHECK SQL correspondiente en
// sql/081_working_hours_contract_marts.sql -un test de "no drift" (ver
// test/working-hours/coverage-reason-codes.test.js) lo verifica contra el
// propio Postgres desechable.

export const SCHEDULE_SOURCE = Object.freeze({
  CONTRACT: "CONTRACT",
  LEGACY_GLOBAL: "LEGACY_GLOBAL"
});

// 11 códigos de Capa B (segment_reason_code) -incluye WITHIN_LEGACY_SCHEDULE,
// que solo aplica bajo schedule_source=LEGACY_GLOBAL.
export const SEGMENT_REASON_CODES = Object.freeze([
  "WITHIN_MATCHED_CONTRACT",
  "WITHIN_LEGACY_SCHEDULE",
  "NO_CONTRACT_AT_TASK_DATE",
  "EQUIPMENT_UNMATCHED",
  "EQUIPMENT_AMBIGUOUS",
  "NO_CONTRACT",
  "NO_CONTRACT_STATUS",
  "ON_DEMAND_UNDEFINED",
  "CONTRACT_STATUS_DEINSTALLED",
  "SCHEDULE_REVIEW_REQUIRED",
  "CRITICALITY_UNKNOWN",
  "HOLIDAY_COVERAGE_UNKNOWN"
]);

// Matriz de qué segment_reason_code es válido bajo cada schedule_source
// (corrige el hallazgo: LEGACY_GLOBAL no tiene equipos, contratos, ni
// matching -solo horario fijo + calendario de feriados).
const CONTRACT_ONLY_REASON_CODES = Object.freeze([
  "WITHIN_MATCHED_CONTRACT",
  "NO_CONTRACT_AT_TASK_DATE",
  "EQUIPMENT_UNMATCHED",
  "EQUIPMENT_AMBIGUOUS",
  "NO_CONTRACT",
  "NO_CONTRACT_STATUS",
  "ON_DEMAND_UNDEFINED",
  "CONTRACT_STATUS_DEINSTALLED",
  "SCHEDULE_REVIEW_REQUIRED",
  "CRITICALITY_UNKNOWN"
]);
const LEGACY_GLOBAL_REASON_CODES = Object.freeze(["WITHIN_LEGACY_SCHEDULE", "HOLIDAY_COVERAGE_UNKNOWN"]);

/**
 * @param {string} reasonCode uno de SEGMENT_REASON_CODES
 * @param {string} scheduleSource uno de SCHEDULE_SOURCE
 * @returns {boolean}
 */
export function isSegmentReasonCodeValidForSource(reasonCode, scheduleSource) {
  if (scheduleSource === SCHEDULE_SOURCE.LEGACY_GLOBAL) {
    return LEGACY_GLOBAL_REASON_CODES.includes(reasonCode);
  }
  if (scheduleSource === SCHEDULE_SOURCE.CONTRACT) {
    return CONTRACT_ONLY_REASON_CODES.includes(reasonCode) || reasonCode === "HOLIDAY_COVERAGE_UNKNOWN";
  }
  return false;
}

// 16 códigos de Capa C (coverage_reason_code / contractual_reason_code) -
// contractual_reason_code nunca incluye WITHIN_LEGACY_SCHEDULE (ese es un
// resultado del fallback, nunca del intento contractual en sí).
export const CAPA_C_REASON_CODES = Object.freeze([
  "WITHIN_MATCHED_CONTRACT",
  "WITHIN_LEGACY_SCHEDULE",
  "MULTIPLE_EQUIPMENT_SAME_COVERAGE",
  "MULTIPLE_EQUIPMENT_CONFLICT",
  "NO_EQUIPMENT",
  "EQUIPMENT_UNMATCHED",
  "EQUIPMENT_AMBIGUOUS",
  "NO_CONTRACT_AT_TASK_DATE",
  "NO_CONTRACT",
  "NO_CONTRACT_STATUS",
  "ON_DEMAND_UNDEFINED",
  "CONTRACT_STATUS_DEINSTALLED",
  "SCHEDULE_REVIEW_REQUIRED",
  "CRITICALITY_UNKNOWN",
  "HOLIDAY_COVERAGE_UNKNOWN",
  "INVALID_START_TIME",
  "INVALID_DURATION",
  "INSUFFICIENT_DATA"
]);

export const CONTRACTUAL_REASON_CODES = Object.freeze(CAPA_C_REASON_CODES.filter(c => c !== "WITHIN_LEGACY_SCHEDULE"));

// Códigos de "éxito" -los únicos con los que calculation_status puede ser
// distinto de NOT_CALCULABLE.
export const CONTRACTUAL_SUCCESS_REASON_CODES = Object.freeze(["WITHIN_MATCHED_CONTRACT", "MULTIPLE_EQUIPMENT_SAME_COVERAGE"]);
export const LEGACY_SUCCESS_REASON_CODE = "WITHIN_LEGACY_SCHEDULE";

// Motivos terminales de intervalo -bajo estos, start/end/duration son NULL
// (bicondicional real, punto 8 de la corrección final).
export const INTERVAL_TERMINAL_REASON_CODES = Object.freeze(["INVALID_START_TIME", "INVALID_DURATION", "INSUFFICIENT_DATA"]);

/** @param {string} code @returns {boolean} */
export function isIntervalTerminal(code) {
  return INTERVAL_TERMINAL_REASON_CODES.includes(code);
}

/** @param {string} code @returns {boolean} */
export function isContractualSuccess(code) {
  return CONTRACTUAL_SUCCESS_REASON_CODES.includes(code);
}

export const DATA_BASIS = Object.freeze({ CONTRACTUAL: "CONTRACTUAL", LEGACY_SCHEDULE: "LEGACY_SCHEDULE", NONE: "NONE" });

export const CALCULATION_STATUS = Object.freeze({
  CALCULATED: "CALCULATED",
  CALCULATED_WITH_WARNINGS: "CALCULATED_WITH_WARNINGS",
  NOT_CALCULABLE: "NOT_CALCULABLE"
});

export const COVERAGE_CLASSIFICATION = Object.freeze({
  FULLY_COVERED: "FULLY_COVERED",
  PARTIALLY_COVERED: "PARTIALLY_COVERED",
  NOT_COVERED: "NOT_COVERED",
  NOT_CALCULABLE: "NOT_CALCULABLE"
});

export const OUTSIDE_COVERAGE_BUCKET = Object.freeze({
  HOLIDAY: "HOLIDAY",
  WEEKEND: "WEEKEND",
  AFTER_HOURS_WEEKDAY: "AFTER_HOURS_WEEKDAY"
});

export const HOLIDAY_COVERAGE_STATUS = Object.freeze({
  CONFIRMED_NOT_HOLIDAY: "CONFIRMED_NOT_HOLIDAY",
  CONFIRMED_HOLIDAY: "CONFIRMED_HOLIDAY",
  COVERAGE_UNKNOWN: "COVERAGE_UNKNOWN"
});

/**
 * Precedencia de bucket para minutos OUTSIDE_COVERAGE (punto 9): HOLIDAY >
 * WEEKEND > AFTER_HOURS_WEEKDAY -partición estricta, sin doble conteo. Un
 * segmento con holiday_coverage_status=COVERAGE_UNKNOWN nunca llega acá (por
 * construcción, ver segment_reason_code=HOLIDAY_COVERAGE_UNKNOWN).
 * @param {{ holidayCoverageStatus: string, dayOfWeek: string }} segment
 * @returns {string} uno de OUTSIDE_COVERAGE_BUCKET
 */
export function resolveOutsideCoverageBucket({ holidayCoverageStatus, dayOfWeek }) {
  if (holidayCoverageStatus === HOLIDAY_COVERAGE_STATUS.COVERAGE_UNKNOWN) {
    throw new Error("resolveOutsideCoverageBucket: holidayCoverageStatus=COVERAGE_UNKNOWN nunca debe llegar a un segmento OUTSIDE_COVERAGE.");
  }
  if (holidayCoverageStatus === HOLIDAY_COVERAGE_STATUS.CONFIRMED_HOLIDAY) {
    return OUTSIDE_COVERAGE_BUCKET.HOLIDAY;
  }
  if (dayOfWeek === "SAT" || dayOfWeek === "SUN") {
    return OUTSIDE_COVERAGE_BUCKET.WEEKEND;
  }
  return OUTSIDE_COVERAGE_BUCKET.AFTER_HOURS_WEEKDAY;
}
