// Resolución del intervalo [start,end) de una tarea FieldBeat, reutilizando
// SOLO la parte de la jerarquía legada (cloud-d1-readonly:src/lib/
// business-hours.js) que sigue siendo correcta sin el truco "fake-UTC local"
// -ese truco (Date.UTC tratando horas de Santiago como si fueran UTC) era
// necesario para un builder 100% JS/CSV sin Postgres, pero es incorrecto
// para producir instantes reales en DST. El día-walk DST-correcto vive en
// SQL nativo dentro del builder de Capa B/C (6.6B2), no acá -este módulo
// solo decide QUÉ intervalo usar, sobre objetos Date reales.

export const CALCULATION_METHOD = Object.freeze({
  EXACT_REPORTED_START_END: "EXACT_REPORTED_START_END",
  ESTIMATED_FROM_START_DURATION: "ESTIMATED_FROM_START_DURATION",
  PARTIAL_ESTIMATE: "PARTIAL_ESTIMATE",
  INVALID_START_TIME: "INVALID_START_TIME",
  INVALID_DURATION: "INVALID_DURATION",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA"
});

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return isValidDate(d) ? d : null;
}

/**
 * @param {{ startTimeRaw?: string|Date|null, reportedEndRaw?: string|Date|null, durationMinutes?: number|null }} task
 * @returns {{
 *   method: string,
 *   startTimeUtc: Date|null,
 *   endTimeUtc: Date|null,
 *   durationSeconds: number|null,
 *   reasonCode: string|null   -- null si el intervalo es resoluble; INVALID_START_TIME/INVALID_DURATION/INSUFFICIENT_DATA si no
 * }}
 */
export function resolveInterval({ startTimeRaw, reportedEndRaw, durationMinutes } = {}) {
  const start = parseDate(startTimeRaw);

  if (!start) {
    return { method: CALCULATION_METHOD.INVALID_START_TIME, startTimeUtc: null, endTimeUtc: null, durationSeconds: null, reasonCode: "INVALID_START_TIME" };
  }

  const reportedEnd = parseDate(reportedEndRaw);
  const durationValid = typeof durationMinutes === "number" && Number.isFinite(durationMinutes) && durationMinutes > 0;

  // 1) EXACT_REPORTED_START_END: hay fin reportado y es posterior al inicio.
  if (reportedEnd && reportedEnd.getTime() > start.getTime()) {
    const durationSeconds = Math.round((reportedEnd.getTime() - start.getTime()) / 1000);
    return { method: CALCULATION_METHOD.EXACT_REPORTED_START_END, startTimeUtc: start, endTimeUtc: reportedEnd, durationSeconds, reasonCode: null };
  }

  // 2) ESTIMATED_FROM_START_DURATION: no hay fin reportado utilizable, pero
  // sí una duración plausible -fin = inicio + duración.
  if (durationValid) {
    const durationSeconds = Math.round(durationMinutes * 60);
    const end = new Date(start.getTime() + durationSeconds * 1000);
    // Si además había un reportedEnd pero no calzaba (ej. anterior al
    // inicio), el método sigue siendo una estimación, nunca "exacto".
    return { method: CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION, startTimeUtc: start, endTimeUtc: end, durationSeconds, reasonCode: null };
  }

  // 3) Sin fin reportado utilizable NI duración válida, pero el inicio SÍ es
  // válido -no hay suficiente dato para estimar un fin, terminal
  // INSUFFICIENT_DATA (distinto de INVALID_DURATION: acá no sabemos si la
  // duración es inválida por sí misma o simplemente no vino).
  if (durationMinutes === null || durationMinutes === undefined) {
    return { method: CALCULATION_METHOD.INSUFFICIENT_DATA, startTimeUtc: null, endTimeUtc: null, durationSeconds: null, reasonCode: "INSUFFICIENT_DATA" };
  }

  // 4) Duración presente pero inválida (<=0, no numérica, etc.).
  return { method: CALCULATION_METHOD.INVALID_DURATION, startTimeUtc: null, endTimeUtc: null, durationSeconds: null, reasonCode: "INVALID_DURATION" };
}
