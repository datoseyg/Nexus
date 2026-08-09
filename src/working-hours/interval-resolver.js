// Resolución del intervalo [start,end) de una tarea FieldBeat + score de
// confiabilidad de 6 factores (fórmula histórica EXACTA, cloud-d1-readonly:
// src/lib/calculation-confidence.js -nunca el reescalado de 7 factores,
// rechazado en 6.6A.1). Paso 1 compartido de la cascada CONTRACTUAL ->
// LEGACY_SCHEDULE -> NONE (este encargo §1): se resuelve UNA vez, antes de
// intentar ninguna base.
//
// Usa instantes UTC REALES (nunca el truco "fake-UTC local" del algoritmo
// original) -ese truco solo se reproduce, deliberadamente, dentro de
// legacy-global-schedule.js en modo legacy_exact_parity, para auditar el
// legado tal cual era, nunca acá.

import { resolveSantiagoPartsToUtc } from "./timezone-resolver.js";

export const CALCULATION_METHOD = Object.freeze({
  EXACT_REPORTED_START_END: "EXACT_REPORTED_START_END",
  ESTIMATED_FROM_START_DURATION: "ESTIMATED_FROM_START_DURATION",
  PARTIAL_ESTIMATE: "PARTIAL_ESTIMATE",
  INVALID_START_TIME: "INVALID_START_TIME",
  INVALID_DURATION: "INVALID_DURATION",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA"
});

export const ANALYSIS_INTERVAL_BASIS = Object.freeze({
  REPORTED_WORK_INTERVAL: "REPORTED_WORK_INTERVAL",
  DELIVERY_FALLBACK: "DELIVERY_FALLBACK",
  TASK_TRANSITIONS: "TASK_TRANSITIONS",
  SCHEDULED_ESTIMATE: "SCHEDULED_ESTIMATE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA"
});

export const CONFIDENCE_TIERS = Object.freeze([
  { min: 0, max: 39, label: "Insuficiente" },
  { min: 40, max: 64, label: "Baja" },
  { min: 65, max: 84, label: "Media" },
  { min: 85, max: 100, label: "Alta" }
]);

const CHILE_WALL_CLOCK_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

/** "DD/MM/YYYY HH:mm" (hora local Chile, sin marcador de zona) -> partes, o null. */
function parseChileWallClockParts(value) {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  const match = raw.match(CHILE_WALL_CLOCK_RE);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]), hour = Number(match[4]), minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() + 1 !== month || calendarCheck.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute, second: 0 };
}

/**
 * Parser canónico de campos DATETIME FieldBeat. Conserva valor crudo,
 * procedencia y estado; nunca depende del locale del runtime.
 */
export function parseFieldbeatDateTime(value, sourceField) {
  const rawValue = value === null || value === undefined ? null : String(value);
  const trimmed = rawValue?.trim() ?? "";
  const base = { rawValue, source: "FORM_FIELD", sourceField: sourceField ?? null };
  if (!trimmed) return { ...base, value: null, parseStatus: "MISSING" };
  const parts = parseChileWallClockParts(trimmed);
  if (!parts) return { ...base, value: null, parseStatus: "INVALID" };
  const resolved = resolveSantiagoPartsToUtc(parts);
  if (resolved.kind === "nonexistent") return { ...base, value: null, parseStatus: "INVALID" };
  return {
    ...base,
    value: new Date(resolved.utcMs),
    parseStatus: resolved.kind === "ambiguous" ? "AMBIGUOUS" : "PARSED"
  };
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return isValidDate(d) ? d : null;
}

/**
 * Regla temporal canónica FieldBeat. El intervalo informado se valida solo
 * contra sí mismo: registro, programación, transiciones y estimación no lo
 * invalidan ni reducen su confianza.
 * @param {{ startTimeRaw?: string|Date|null, reportedStartRaw?: string|null, reportedEndRaw?: string|null, durationMinutes?: number|null }} task
 * @returns {{ method: string, startTimeUtc: Date|null, endTimeUtc: Date|null, durationSeconds: number|null, reasonCode: string|null, reportedEvaluation: object|null }}
 */
export function resolveReportAnalysisInterval({ startTimeRaw, reportedStartRaw, reportedEndRaw, deliveredRaw, durationMinutes } = {}) {
  // Normalización a whole-seconds (Capa C exige date_trunc('second', x) = x
  // para start_time_utc/end_time_utc, sql/081) -start_time de FieldBeat
  // puede traer milisegundos; se trunca acá, en el origen, para que
  // duration_seconds = end_time_utc - start_time_utc quede exacto en
  // AMBOS extremos derivados (ESTIMATED_FROM_START_DURATION/PARTIAL_ESTIMATE
  // suman duration_seconds sobre start, así que un start con sub-segundo
  // contaminaría también el end).
  const startRaw = parseDate(startTimeRaw);
  const start = startRaw ? new Date(Math.floor(startRaw.getTime() / 1000) * 1000) : null;
  const durationNum = durationMinutes === null || durationMinutes === undefined || durationMinutes === "" ? null : Number(durationMinutes);
  const durationPresent = durationNum !== null && !Number.isNaN(durationNum);
  const durationPositive = durationPresent && durationNum > 0;
  const durationSuspicious = durationPositive && (durationNum < 5 || durationNum >= 480 || durationNum === 1440);

  const reportedStart = parseFieldbeatDateTime(reportedStartRaw, "HORA DE INICIO DEL TRABAJO");
  const reportedEnd = parseFieldbeatDateTime(reportedEndRaw, "HORA DE TERMINO DEL TRABAJO");
  const delivered = parseFieldbeatDateTime(deliveredRaw, "FECHA Y HORA DE ENTREGA");
  const temporalIssues = [];
  let reportedFailureReason = "REPORTED_INTERVAL_MISSING";

  const hasReportedStart = reportedStart.parseStatus !== "MISSING";
  const hasReportedEnd = reportedEnd.parseStatus !== "MISSING";
  if (hasReportedStart !== hasReportedEnd) {
    reportedFailureReason = "REPORTED_INTERVAL_INCOMPLETE";
    temporalIssues.push(reportedFailureReason);
  } else if (hasReportedStart && hasReportedEnd) {
    if (reportedStart.parseStatus === "AMBIGUOUS" || reportedEnd.parseStatus === "AMBIGUOUS") {
      reportedFailureReason = "TEMPORAL_FIELD_AMBIGUOUS";
      temporalIssues.push(reportedFailureReason);
    } else if (reportedStart.parseStatus !== "PARSED" || reportedEnd.parseStatus !== "PARSED") {
      reportedFailureReason = "TEMPORAL_FIELD_UNPARSEABLE";
      temporalIssues.push(reportedFailureReason);
    } else if (reportedEnd.value.getTime() < reportedStart.value.getTime()) {
      reportedFailureReason = "REPORTED_WORK_END_PRECEDES_START";
      temporalIssues.push(reportedFailureReason);
    } else {
      if (delivered.parseStatus === "PARSED" && delivered.value.getTime() < reportedEnd.value.getTime()) {
        temporalIssues.push("DELIVERY_PRECEDES_REPORTED_END");
      }
      const durationSeconds = Math.round((reportedEnd.value.getTime() - reportedStart.value.getTime()) / 1000);
      const reportedEvaluation = {
        plausible: true,
        reason: "intervalo informado completo y coherente",
        startUtcMs: reportedStart.value.getTime(),
        endUtcMs: reportedEnd.value.getTime()
      };
      return {
        method: CALCULATION_METHOD.EXACT_REPORTED_START_END,
        startTimeUtc: reportedStart.value,
        endTimeUtc: reportedEnd.value,
        durationSeconds,
        reasonCode: null,
        reportedEvaluation,
        reportedStart,
        reportedEnd,
        delivered,
        analysisIntervalBasis: ANALYSIS_INTERVAL_BASIS.REPORTED_WORK_INTERVAL,
        analysisFallbackUsed: false,
        analysisFallbackReason: null,
        temporalIssues
      };
    }
  }

  if (!start) {
    return {
      method: CALCULATION_METHOD.INVALID_START_TIME, startTimeUtc: null, endTimeUtc: null, durationSeconds: null,
      reasonCode: "INVALID_START_TIME", reportedEvaluation: { plausible: false, reason: reportedFailureReason, startUtcMs: reportedStart.value?.getTime() ?? null, endUtcMs: reportedEnd.value?.getTime() ?? null },
      reportedStart, reportedEnd, delivered, analysisIntervalBasis: ANALYSIS_INTERVAL_BASIS.INSUFFICIENT_DATA,
      analysisFallbackUsed: false, analysisFallbackReason: reportedFailureReason, temporalIssues
    };
  }

  const reportedEvaluation = { plausible: false, reason: reportedFailureReason, startUtcMs: reportedStart.value?.getTime() ?? null, endUtcMs: reportedEnd.value?.getTime() ?? null };

  if (durationPositive && !durationSuspicious) {
    const durationSeconds = Math.round(durationNum * 60);
    return { method: CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION, startTimeUtc: start, endTimeUtc: new Date(start.getTime() + durationSeconds * 1000), durationSeconds, reasonCode: null, reportedEvaluation, reportedStart, reportedEnd, delivered, analysisIntervalBasis: ANALYSIS_INTERVAL_BASIS.SCHEDULED_ESTIMATE, analysisFallbackUsed: true, analysisFallbackReason: reportedFailureReason, temporalIssues };
  }

  if (durationSuspicious) {
    if (durationPositive) {
      const durationSeconds = Math.round(durationNum * 60);
      return { method: CALCULATION_METHOD.PARTIAL_ESTIMATE, startTimeUtc: start, endTimeUtc: new Date(start.getTime() + durationSeconds * 1000), durationSeconds, reasonCode: null, reportedEvaluation, reportedStart, reportedEnd, delivered, analysisIntervalBasis: ANALYSIS_INTERVAL_BASIS.SCHEDULED_ESTIMATE, analysisFallbackUsed: true, analysisFallbackReason: reportedFailureReason, temporalIssues };
    }
  }

  if (!durationPresent) {
    return { method: CALCULATION_METHOD.INSUFFICIENT_DATA, startTimeUtc: null, endTimeUtc: null, durationSeconds: null, reasonCode: "INSUFFICIENT_DATA", reportedEvaluation, reportedStart, reportedEnd, delivered, analysisIntervalBasis: ANALYSIS_INTERVAL_BASIS.INSUFFICIENT_DATA, analysisFallbackUsed: false, analysisFallbackReason: reportedFailureReason, temporalIssues };
  }

  return { method: CALCULATION_METHOD.INVALID_DURATION, startTimeUtc: null, endTimeUtc: null, durationSeconds: null, reasonCode: "INVALID_DURATION", reportedEvaluation, reportedStart, reportedEnd, delivered, analysisIntervalBasis: ANALYSIS_INTERVAL_BASIS.INSUFFICIENT_DATA, analysisFallbackUsed: false, analysisFallbackReason: reportedFailureReason, temporalIssues };
}

function clampScore(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}
function tierLabel(score) {
  const clamped = clampScore(score);
  return (CONFIDENCE_TIERS.find(t => clamped >= t.min && clamped <= t.max) ?? CONFIDENCE_TIERS[0]).label;
}

/**
 * Score de confiabilidad de 6 factores, EXACTO a
 * cloud-d1-readonly:src/lib/calculation-confidence.js#calculateTaskTimeConfidence.
 * Mide calidad METODOLÓGICA del intervalo, no una probabilidad estadística.
 * @param {{ startTimeRaw, durationMinutes, clientKey, taskType, assignedTo }} task
 * @param {{ businessHoursStatus: string, holidaysStatus: string, reportedEvaluation: object|null }} context
 * @returns {{ score:number, label:string, factors:string }}
 */
export function calculateConfidence(task, context = {}) {
  const factorDetails = [];
  let score = 0;

  const startDate = task.startTimeRaw ? parseDate(task.startTimeRaw) : null;
  const startValid = !!startDate;
  if (startValid) { score += 25; factorDetails.push({ reason: "start_time válido", points: 25 }); }
  else factorDetails.push({ reason: "start_time ausente o inválido", points: 0 });

  const durationNum = Number(task.durationMinutes);
  const durationPresent = task.durationMinutes !== undefined && task.durationMinutes !== null && task.durationMinutes !== "" && !Number.isNaN(durationNum);
  const durationPositive = durationPresent && durationNum > 0;
  const durationSuspicious = durationPositive && (durationNum < 5 || durationNum >= 480 || durationNum === 1440);
  const durationValid = durationPositive && !durationSuspicious;

  if (durationValid) { score += 25; factorDetails.push({ reason: "duration_minutes válido", points: 25 }); }
  else if (durationSuspicious) { score += 10; factorDetails.push({ reason: "duration_minutes sospechoso o extremo", points: 10 }); }
  else factorDetails.push({ reason: "duration_minutes ausente, cero o negativo", points: 0 });

  const hasPlausibleReported = !!context.reportedEvaluation?.plausible;
  if (hasPlausibleReported) { score += 15; factorDetails.push({ reason: "hora de término reportada y validada (plausible contra duration_minutes)", points: 15 }); }
  else if (startValid) { score += 5; factorDetails.push({ reason: "hora de término estimada (start_time + duration_minutes)", points: 5 }); }
  else factorDetails.push({ reason: "no se puede estimar hora de término (start_time inválido)", points: 0 });

  const businessHoursStatus = context.businessHoursStatus || "MISSING";
  if (businessHoursStatus === "VALIDATED") { score += 15; factorDetails.push({ reason: "calendario laboral configurado y validado con negocio", points: 15 }); }
  else if (businessHoursStatus === "DEFAULT_UNVALIDATED") { score += 8; factorDetails.push({ reason: "calendario laboral configurado pero sin validar con negocio (default)", points: 8 }); }
  else factorDetails.push({ reason: "no existe calendario laboral configurado", points: 0 });

  const holidaysStatus = context.holidaysStatus || "MISSING";
  if (holidaysStatus === "VALIDATED") { score += 10; factorDetails.push({ reason: "feriados validados con negocio", points: 10 }); }
  else if (holidaysStatus === "EXAMPLE_INCOMPLETE") { score += 3; factorDetails.push({ reason: "feriados: solo fechas fijas, archivo example incompleto", points: 3 }); }
  else factorDetails.push({ reason: "no hay calendario de feriados configurado", points: 0 });

  const hasClient = !!String(task.clientKey ?? "").trim();
  const secondaryCount = [!!String(task.taskType ?? "").trim(), !!String(task.assignedTo ?? "").trim()].filter(Boolean).length;
  if (hasClient && secondaryCount === 2) { score += 10; factorDetails.push({ reason: "trazabilidad completa (cliente, tipo de tarea, técnico)", points: 10 }); }
  else if (hasClient && secondaryCount === 1) { score += 5; factorDetails.push({ reason: "trazabilidad parcial (falta tipo de tarea o técnico)", points: 5 }); }
  else factorDetails.push({ reason: "trazabilidad insuficiente (falta cliente y/o dos campos secundarios)", points: 0 });

  const clampedScore = clampScore(score);
  return { score: clampedScore, label: tierLabel(clampedScore), factors: factorDetails.map(f => `${f.reason} (+${f.points})`).join(" | ") };
}
