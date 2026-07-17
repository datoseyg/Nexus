// Dos motores DELIBERADAMENTE separados sobre el mismo horario global
// (data/config/business-hours.json, Lun-Vie 08:30-18:30, DEFAULT_UNVALIDATED):
//
// legacy_exact_parity  -reproduce el algoritmo histórico TAL CUAL, incluido
//   el truco "fake-UTC local" y su desconocimiento de DST. Existe solo para
//   auditoría/paridad contra el mart congelado (tolerancia 0). NUNCA se usa
//   como fallback productivo.
// legacy_corrected_v2  -usa segmentación DST-correcta real (segment-
//   boundaries.js/timezone-resolver.js) + calendario gobernado
//   (config.current_holiday_calendar_*, vía lookup inyectado). Es el
//   fallback productivo real de la cascada CONTRACTUAL -> LEGACY_SCHEDULE.
//
// Nunca se mezclan internamente -cada uno vive en su propia sección de este
// archivo, sin funciones compartidas de bajo nivel (evita que un fix de uno
// contamine silenciosamente al otro).

import { partitionInterval } from "./segment-boundaries.js";

// ============================================================
// legacy_exact_parity -reimplementación fiel y AISLADA del algoritmo
// original (cloud-d1-readonly:src/lib/business-hours.js). Aritmética de
// milisegundos sobre un espacio "fake-UTC local" -CORRECTA únicamente
// dentro de ese espacio inventado y autocontenido, nunca sobre instantes
// UTC reales. No reutiliza timezone-resolver.js a propósito.
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SANTIAGO_TZ = "America/Santiago";

const PARTS_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: SANTIAGO_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function toSantiagoParts(dateOrIso) {
  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(PARTS_FMT.formatToParts(date).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: parts.hour === "24" ? 0 : Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
function partsToFakeUtcMs(parts) {
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
}
function utcIsoToLocalFakeMs(isoOrDate) {
  return partsToFakeUtcMs(toSantiagoParts(isoOrDate));
}
const CHILE_WALL_CLOCK_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;
function parseChileWallClockFake(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(CHILE_WALL_CLOCK_RE);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]), hour = Number(match[4]), minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, 0);
}
function formatLocalFakeMs(fakeMs) {
  if (fakeMs === null || fakeMs === undefined || Number.isNaN(fakeMs)) return "";
  return new Date(fakeMs).toISOString().replace("T", " ").replace(".000Z", "");
}
function dateKeyOfDayStart(dayStartMs) { return new Date(dayStartMs).toISOString().slice(0, 10); }
function weekdayNameOfDayStart(dayStartMs) { return WEEKDAY_NAMES[new Date(dayStartMs).getUTCDay()]; }
function parseHHMM(value) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Reproduce classifyInterval EXACTO del algoritmo original (día-walk fake-UTC, dayStart+DAY_MS). */
export function classifyIntervalExact(startMs, endMs, businessHoursCfg, holidayDatesSet) {
  const totals = { business_minutes: 0, after_hours_weekday_minutes: 0, weekend_minutes: 0, holiday_minutes: 0 };
  if (!(typeof startMs === "number") || !(typeof endMs === "number") || !(endMs > startMs)) return totals;

  const schedule = businessHoursCfg?.weekly_schedule || {};
  let cursor = startMs;
  while (cursor < endMs) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    const segmentEnd = Math.min(endMs, dayStart + DAY_MS);
    const segmentMinutes = (segmentEnd - cursor) / 60000;
    const dateKey = dateKeyOfDayStart(dayStart);

    if (holidayDatesSet.has(dateKey)) {
      totals.holiday_minutes += segmentMinutes;
    } else {
      const daySchedule = schedule[weekdayNameOfDayStart(dayStart)];
      if (!daySchedule || daySchedule.is_business_day === false) {
        totals.weekend_minutes += segmentMinutes;
      } else {
        const winStartMin = parseHHMM(daySchedule.start);
        const winEndMin = parseHHMM(daySchedule.end);
        if (winStartMin === null || winEndMin === null) {
          totals.weekend_minutes += segmentMinutes;
        } else {
          const windowStart = dayStart + winStartMin * 60000;
          const windowEnd = dayStart + winEndMin * 60000;
          const overlapMinutes = Math.max(0, (Math.min(segmentEnd, windowEnd) - Math.max(cursor, windowStart)) / 60000);
          totals.business_minutes += overlapMinutes;
          totals.after_hours_weekday_minutes += segmentMinutes - overlapMinutes;
        }
      }
    }
    cursor = segmentEnd;
  }
  return totals;
}

/**
 * Corre el pipeline legado COMPLETO para una tarea (intervalo + confianza +
 * clasificación), exacto al original, para comparar 1:1 contra el mart
 * congelado. reportedInterval = { startRaw, endRaw } (strings "DD/MM/YYYY
 * HH:mm") o null.
 */
export function computeLegacyExactParity({ task, reportedInterval, businessHoursCfg, holidaysCfg }) {
  const { calculateTaskTimeConfidence, calculationStatusFromMethod } = legacyConfidenceModule();

  const durationMinutes = Number(task.duration_minutes || 0);
  const startLocalMs = task.start_time ? utcIsoToLocalFakeMs(task.start_time) : null;

  const rawInterval = reportedInterval
    ? { startRaw: reportedInterval.startRaw, endRaw: reportedInterval.endRaw, startMs: parseChileWallClockFake(reportedInterval.startRaw), endMs: parseChileWallClockFake(reportedInterval.endRaw) }
    : null;
  const evaluation = evaluateReportedIntervalExact(rawInterval, durationMinutes);

  const taskContext = {
    businessHoursStatus: businessHoursCfg.status,
    holidaysStatus: holidaysCfg.status,
    reportedInterval: rawInterval && rawInterval.startMs !== null && rawInterval.endMs !== null ? { startMs: rawInterval.startMs, endMs: rawInterval.endMs, plausible: evaluation.plausible } : null
  };

  const confidence = calculateTaskTimeConfidence(task, taskContext);
  const calculationStatus = calculationStatusFromMethod(confidence.method);

  let intervalStartMs = null, intervalEndMs = null, estimatedEndLocalMs = null;
  if (confidence.method === "EXACT_REPORTED_START_END") {
    intervalStartMs = rawInterval.startMs;
    intervalEndMs = rawInterval.endMs;
  } else if (startLocalMs !== null && durationMinutes > 0) {
    intervalStartMs = startLocalMs;
    intervalEndMs = startLocalMs + durationMinutes * 60000;
    estimatedEndLocalMs = intervalEndMs;
  }

  let classification = { business_minutes: 0, after_hours_weekday_minutes: 0, weekend_minutes: 0, holiday_minutes: 0 };
  if (intervalStartMs !== null && intervalEndMs !== null && intervalEndMs > intervalStartMs) {
    classification = classifyIntervalExact(intervalStartMs, intervalEndMs, businessHoursCfg, holidaysCfg.dates);
  }

  const afterHoursTotalMinutes = classification.after_hours_weekday_minutes + classification.weekend_minutes + classification.holiday_minutes;
  const usedDurationMinutes = intervalStartMs !== null && intervalEndMs !== null ? (intervalEndMs - intervalStartMs) / 60000 : 0;
  const afterHoursRate = usedDurationMinutes > 0 ? afterHoursTotalMinutes / usedDurationMinutes : 0;

  return {
    start_time_local: startLocalMs !== null ? formatLocalFakeMs(startLocalMs) : "",
    estimated_end_time_local: estimatedEndLocalMs !== null ? formatLocalFakeMs(estimatedEndLocalMs) : "",
    reported_start_raw: rawInterval?.startRaw || "",
    reported_end_raw: rawInterval?.endRaw || "",
    reported_interval_plausible: rawInterval ? evaluation.plausible : "",
    business_minutes: Math.round(classification.business_minutes),
    after_hours_weekday_minutes: Math.round(classification.after_hours_weekday_minutes),
    weekend_minutes: Math.round(classification.weekend_minutes),
    holiday_minutes: Math.round(classification.holiday_minutes),
    after_hours_total_minutes: Math.round(afterHoursTotalMinutes),
    after_hours_rate: Number(afterHoursRate.toFixed(4)),
    is_after_hours_task: afterHoursTotalMinutes > 0,
    calculation_method: confidence.method,
    calculation_status: calculationStatus,
    confidence_score: confidence.score,
    confidence_label: confidence.label,
    confidence_factors: confidence.factors
  };
}

function evaluateReportedIntervalExact(interval, durationMinutes) {
  if (!interval || interval.startMs === null || interval.endMs === null) return { plausible: false, reason: "sin par reportado o formato inválido" };
  if (!(interval.endMs > interval.startMs)) return { plausible: false, reason: "hora de término reportada es anterior o igual a la de inicio" };
  const spanMinutes = (interval.endMs - interval.startMs) / 60000;
  if (spanMinutes > 1440) return { plausible: false, reason: `lapso reportado (${Math.round(spanMinutes)} min) cruza más de un día calendario` };
  if (!(durationMinutes > 0)) return { plausible: false, reason: "duration_minutes inválido, no se puede contrastar plausibilidad" };
  const tolerance = Math.max(60, 0.5 * durationMinutes);
  if (Math.abs(spanMinutes - durationMinutes) > tolerance) return { plausible: false, reason: "fuera de tolerancia" };
  return { plausible: true, reason: "consistente" };
}

// calculateTaskTimeConfidence/calculationStatusFromMethod EXACTOS -
// duplicados deliberadamente acá (no importados de interval-resolver.js)
// para que legacy_exact_parity sea 100% autocontenido y nunca se vea
// afectado por un cambio futuro al motor forward-looking.
function legacyConfidenceModule() {
  const CONFIDENCE_TIERS = [{ min: 0, max: 39, label: "Insuficiente" }, { min: 40, max: 64, label: "Baja" }, { min: 65, max: 84, label: "Media" }, { min: 85, max: 100, label: "Alta" }];
  const NOT_CALCULABLE_METHODS = new Set(["INVALID_START_TIME", "INVALID_DURATION", "INSUFFICIENT_DATA"]);
  function clampScore(v) { const n = Number(v); return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n))); }
  function tier(score) { const c = clampScore(score); return CONFIDENCE_TIERS.find(t => c >= t.min && c <= t.max) ?? CONFIDENCE_TIERS[0]; }

  function calculationStatusFromMethod(method) {
    if (method === "PARTIAL_ESTIMATE") return "CALCULATED_WITH_WARNINGS";
    if (NOT_CALCULABLE_METHODS.has(method)) return "NOT_CALCULABLE";
    return "CALCULATED";
  }

  function calculateTaskTimeConfidence(task, context = {}) {
    const factorDetails = [];
    let score = 0;
    const startTimeRaw = task.start_time ?? task.start_time_utc;
    const startDate = startTimeRaw ? new Date(startTimeRaw) : null;
    const startValid = !!startDate && !Number.isNaN(startDate.getTime());
    if (startValid) { score += 25; factorDetails.push({ points: 25, reason: "start_time válido" }); }
    else factorDetails.push({ points: 0, reason: "start_time ausente o inválido" });

    const durationNum = Number(task.duration_minutes);
    const durationPresent = task.duration_minutes !== undefined && task.duration_minutes !== null && task.duration_minutes !== "" && !Number.isNaN(durationNum);
    const durationPositive = durationPresent && durationNum > 0;
    const durationSuspicious = durationPositive && (durationNum < 5 || durationNum >= 480 || durationNum === 1440);
    const durationValid = durationPositive && !durationSuspicious;
    if (durationValid) { score += 25; factorDetails.push({ points: 25, reason: "duration_minutes válido" }); }
    else if (durationSuspicious) { score += 10; factorDetails.push({ points: 10, reason: "duration_minutes sospechoso o extremo" }); }
    else factorDetails.push({ points: 0, reason: "duration_minutes ausente, cero o negativo" });

    const reportedInterval = context.reportedInterval || null;
    const hasPlausibleReported = !!(reportedInterval && reportedInterval.plausible);
    if (hasPlausibleReported) { score += 15; factorDetails.push({ points: 15, reason: "hora de término reportada y validada (plausible contra duration_minutes)" }); }
    else if (startValid) { score += 5; factorDetails.push({ points: 5, reason: "hora de término estimada (start_time + duration_minutes)" }); }
    else factorDetails.push({ points: 0, reason: "no se puede estimar hora de término (start_time inválido)" });

    const businessHoursStatus = context.businessHoursStatus || "MISSING";
    if (businessHoursStatus === "VALIDATED") { score += 15; factorDetails.push({ points: 15, reason: "calendario laboral configurado y validado con negocio" }); }
    else if (businessHoursStatus === "DEFAULT_UNVALIDATED") { score += 8; factorDetails.push({ points: 8, reason: "calendario laboral configurado pero sin validar con negocio (default)" }); }
    else factorDetails.push({ points: 0, reason: "no existe calendario laboral configurado" });

    const holidaysStatus = context.holidaysStatus || "MISSING";
    if (holidaysStatus === "VALIDATED") { score += 10; factorDetails.push({ points: 10, reason: "feriados validados con negocio" }); }
    else if (holidaysStatus === "EXAMPLE_INCOMPLETE") { score += 3; factorDetails.push({ points: 3, reason: "feriados: solo fechas fijas, archivo example incompleto" }); }
    else factorDetails.push({ points: 0, reason: "no hay calendario de feriados configurado" });

    const hasClient = !!String(task.client_key ?? "").trim();
    const secondaryCount = [!!String(task.task_type ?? "").trim(), !!String(task.assigned_to ?? "").trim()].filter(Boolean).length;
    if (hasClient && secondaryCount === 2) { score += 10; factorDetails.push({ points: 10, reason: "trazabilidad completa (cliente, tipo de tarea, técnico)" }); }
    else if (hasClient && secondaryCount === 1) { score += 5; factorDetails.push({ points: 5, reason: "trazabilidad parcial (falta tipo de tarea o técnico)" }); }
    else factorDetails.push({ points: 0, reason: "trazabilidad insuficiente (falta cliente y/o dos campos secundarios)" });

    const clampedScore = clampScore(score);
    let method;
    if (!startValid) method = "INVALID_START_TIME";
    else if (hasPlausibleReported) method = "EXACT_REPORTED_START_END";
    else if (durationValid) method = "ESTIMATED_FROM_START_DURATION";
    else if (durationSuspicious || (reportedInterval && !reportedInterval.plausible)) method = "PARTIAL_ESTIMATE";
    else if (!durationPositive) method = "INVALID_DURATION";
    else method = "INSUFFICIENT_DATA";

    return { score: clampedScore, label: tier(clampedScore).label, method, factors: factorDetails.map(f => `${f.reason} (+${f.points})`).join(" | ") };
  }

  return { calculateTaskTimeConfidence, calculationStatusFromMethod };
}

// ============================================================
// legacy_corrected_v2 -segmentación DST-correcta real contra el MISMO
// horario global, más calendario gobernado (lookup inyectado, nunca lee
// config.holiday_calendar_entries directo -ver db-writer.js).
// ============================================================

const WEEKLY_SCHEDULE_TO_WINDOWS_DOW = { monday: "MON", tuesday: "TUE", wednesday: "WED", thursday: "THU", friday: "FRI", saturday: "SAT", sunday: "SUN" };

/** business-hours.json -> ventanas [{dayOfWeek, startMinute, endMinute, allDay}], mismo formato que contract-resolver.js. */
export function businessHoursConfigToWindows(businessHoursCfg) {
  const windows = [];
  for (const [dayName, dow] of Object.entries(WEEKLY_SCHEDULE_TO_WINDOWS_DOW)) {
    const day = businessHoursCfg?.weekly_schedule?.[dayName];
    if (!day || day.is_business_day === false) continue;
    const [startH, startM] = String(day.start ?? "00:00").split(":").map(Number);
    const [endH, endM] = String(day.end ?? "00:00").split(":").map(Number);
    windows.push({ dayOfWeek: dow, startMinute: startH * 60 + startM, endMinute: endH * 60 + endM, allDay: false });
  }
  return windows;
}

/**
 * Segmenta [startUtcMs,endUtcMs) contra el horario global, DST-correcto,
 * con calendario gobernado. holidayLookup(localDateStr) ->
 * 'CONFIRMED_HOLIDAY'|'CONFIRMED_NOT_HOLIDAY'|'COVERAGE_UNKNOWN'.
 * @returns {object[]} segmentos con segment_coverage_state/segment_reason_code ya resueltos (schedule_source=LEGACY_GLOBAL)
 */
export function segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, holidayLookup) {
  const windows = businessHoursConfigToWindows(businessHoursCfg);
  const rawSegments = partitionInterval(startUtcMs, endUtcMs, windows);

  return rawSegments.map(seg => {
    const segmentSeconds = Math.round((seg.endUtcMs - seg.startUtcMs) / 1000);
    const holidayStatus = holidayLookup(seg.localDate);

    if (holidayStatus === "COVERAGE_UNKNOWN") {
      return {
        segmentStartUtcMs: seg.startUtcMs, segmentEndUtcMs: seg.endUtcMs, localDate: seg.localDate, dayOfWeek: seg.dayOfWeek,
        segmentSeconds, holidayCoverageStatus: "COVERAGE_UNKNOWN", isHoliday: null,
        segmentCalculationStatus: "NOT_CALCULABLE", segmentCoverageState: "NOT_CALCULABLE", segmentReasonCode: "HOLIDAY_COVERAGE_UNKNOWN",
        outsideCoverageBucket: null, coveredSeconds: null, outsideCoverageSeconds: null
      };
    }

    const isHoliday = holidayStatus === "CONFIRMED_HOLIDAY";
    const covered = !isHoliday && seg.withinWindow;
    let outsideCoverageBucket = null;
    if (!covered) {
      outsideCoverageBucket = isHoliday ? "HOLIDAY" : (seg.dayOfWeek === "SAT" || seg.dayOfWeek === "SUN") ? "WEEKEND" : "AFTER_HOURS_WEEKDAY";
    }

    return {
      segmentStartUtcMs: seg.startUtcMs, segmentEndUtcMs: seg.endUtcMs, localDate: seg.localDate, dayOfWeek: seg.dayOfWeek,
      segmentSeconds, holidayCoverageStatus: isHoliday ? "CONFIRMED_HOLIDAY" : "CONFIRMED_NOT_HOLIDAY", isHoliday,
      segmentCalculationStatus: "CALCULATED", segmentCoverageState: covered ? "COVERED" : "OUTSIDE_COVERAGE", segmentReasonCode: "WITHIN_LEGACY_SCHEDULE",
      outsideCoverageBucket, coveredSeconds: covered ? segmentSeconds : 0, outsideCoverageSeconds: covered ? 0 : segmentSeconds
    };
  });
}
