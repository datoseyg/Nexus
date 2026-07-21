// Agregación de segmentos (Capa B) a una fila de tarea (Capa C) -invariantes
// exactas en segundos enteros, precedencia HOLIDAY > WEEKEND >
// AFTER_HOURS_WEEKDAY sin doble conteo (ETAPA 6.6B0 §9-10 / este encargo §10).

import { isContractualSuccess } from "./coverage-reason-codes.js";

const RATE_SCALE = 10000n;

/**
 * Redondeo racional EXACTO (round-half-up) de numerator/denominator a 4
 * decimales, con aritmética entera (BigInt) en todos los pasos
 * intermedios -sin punto flotante hasta la división final por escala.
 * Reproduce EXACTAMENTE ROUND(numerator::numeric / denominator, 4) de
 * PostgreSQL (aritmética decimal exacta), a diferencia de
 * Math.round(x*10000)/10000 (JS), que puede diferir justo en el límite de
 * un empate por la representación binaria de punto flotante -ver ETAPA
 * 6.5.2B1.1 (caso real: tarea 464, 1809/7200 = 0.25125 exacto; Postgres
 * redondea a 0.2513, Math.round flotante daba 0.2512, disparando el CHECK
 * de marts.fieldbeat_working_hours_analysis_v2).
 * @param {number} numerator segundos enteros, >= 0
 * @param {number} denominator segundos enteros, > 0
 * @returns {number} cociente redondeado a 4 decimales
 */
export function roundRateExact(numerator, denominator) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new RangeError(`roundRateExact: numerator y denominator deben ser enteros (recibido numerator=${numerator}, denominator=${denominator})`);
  }
  if (numerator < 0) {
    throw new RangeError(`roundRateExact: numerator no puede ser negativo (recibido ${numerator})`);
  }
  if (denominator <= 0) {
    throw new RangeError(`roundRateExact: denominator debe ser > 0 (recibido ${denominator})`);
  }

  const scaledNumerator = BigInt(numerator) * RATE_SCALE;
  const bigDenominator = BigInt(denominator);
  const quotient = scaledNumerator / bigDenominator;
  const remainder = scaledNumerator % bigDenominator;
  const roundedQuotient = 2n * remainder >= bigDenominator ? quotient + 1n : quotient;

  return Number(roundedQuotient) / Number(RATE_SCALE);
}

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
  const afterHoursRate = durationSeconds > 0 ? roundRateExact(afterHoursTotalSeconds, durationSeconds) : 0;

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
