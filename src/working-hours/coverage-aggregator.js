// Agregación de segmentos (Capa B) a una fila de tarea (Capa C) -invariantes
// exactas en segundos enteros, precedencia HOLIDAY > WEEKEND >
// AFTER_HOURS_WEEKDAY sin doble conteo (ETAPA 6.6B0 §9-10 / este encargo §10).

import { isContractualSuccess } from "./coverage-reason-codes.js";

/**
 * @param {object[]} segments segmentos de UN equipo/fuente ya resueltos (segmentCoverageState, segmentSeconds, coveredSeconds, outsideCoverageSeconds, outsideCoverageBucket)
 * @returns {{
 *   calculable: boolean,
 *   coveredSeconds: number|null, outsideCoverageSeconds: number|null,
 *   afterHoursWeekdaySeconds: number|null, weekendSeconds: number|null, holidaySeconds: number|null, afterHoursTotalSeconds: number|null,
 *   isAfterHoursTask: boolean|null, afterHoursRate: number|null,
 *   coverageClassification: string
 * }}
 */
export function aggregateSegments(segments) {
  if (segments.some(s => s.segmentCoverageState === "NOT_CALCULABLE")) {
    return {
      calculable: false, coveredSeconds: null, outsideCoverageSeconds: null,
      afterHoursWeekdaySeconds: null, weekendSeconds: null, holidaySeconds: null, afterHoursTotalSeconds: null,
      isAfterHoursTask: null, afterHoursRate: null, coverageClassification: "NOT_CALCULABLE"
    };
  }

  let coveredSeconds = 0, outsideCoverageSeconds = 0, weekday = 0, weekend = 0, holiday = 0;
  for (const s of segments) {
    coveredSeconds += s.coveredSeconds;
    outsideCoverageSeconds += s.outsideCoverageSeconds;
    if (s.segmentCoverageState === "OUTSIDE_COVERAGE") {
      if (s.outsideCoverageBucket === "HOLIDAY") holiday += s.outsideCoverageSeconds;
      else if (s.outsideCoverageBucket === "WEEKEND") weekend += s.outsideCoverageSeconds;
      else weekday += s.outsideCoverageSeconds;
    }
  }

  const durationSeconds = coveredSeconds + outsideCoverageSeconds;
  const afterHoursTotalSeconds = weekday + weekend + holiday; // = outsideCoverageSeconds por construcción (partición estricta)
  const isAfterHoursTask = afterHoursTotalSeconds > 0;
  const afterHoursRate = durationSeconds > 0 ? Math.round((afterHoursTotalSeconds / durationSeconds) * 10000) / 10000 : 0;

  const coverageClassification = outsideCoverageSeconds === 0 ? "FULLY_COVERED" : coveredSeconds === 0 ? "NOT_COVERED" : "PARTIALLY_COVERED";

  return { calculable: true, coveredSeconds, outsideCoverageSeconds, afterHoursWeekdaySeconds: weekday, weekendSeconds: weekend, holidaySeconds: holiday, afterHoursTotalSeconds, isAfterHoursTask, afterHoursRate, coverageClassification };
}

/**
 * @param {string} reasonCode uno de los 16 códigos de Capa C
 * @returns {boolean} true si el reasonCode es compatible con calculable=true
 */
export function isSuccessReasonCode(reasonCode) {
  return isContractualSuccess(reasonCode) || reasonCode === "WITHIN_LEGACY_SCHEDULE";
}
