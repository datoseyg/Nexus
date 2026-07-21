// Orquestador por tarea: cascada CONTRACTUAL -> LEGACY_SCHEDULE -> NONE
// (este encargo §1). Módulo puro: recibe datos ya resueltos por el llamador
// (db-writer.js hace las consultas), nunca toca la base directamente.
// Conserva SIEMPRE contractual_attempt_status/_coverage_classification/
// _reason_code, incluso cuando el resultado final es LEGACY_SCHEDULE o NONE.

import { resolveInterval, calculateConfidence } from "./interval-resolver.js";
import { resolveEquipmentContract } from "./contract-resolver.js";
import { partitionInterval } from "./segment-boundaries.js";
import { segmentLegacyCorrectedV2 } from "./legacy-global-schedule.js";
import { aggregateSegments } from "./coverage-aggregator.js";
import { computeCoverageFingerprint, evaluateMultiEquipmentEquivalence, mergeIntervals } from "./equipment-coverage-equivalence.js";
import { calculateContractResolutionConfidence } from "./contract-resolution-confidence.js";
import { isIntervalTerminal } from "./coverage-reason-codes.js";
import { dayOfWeekAt, localDateStringAt } from "./timezone-resolver.js";

/**
 * Convierte ventanas de config.contract_service_windows (start_time/end_time
 * "HH:MM:SS" o similar, all_day) al formato {dayOfWeek,startMinute,endMinute,allDay}
 * que segment-boundaries.js espera.
 */
function toMinuteWindows(rawWindows) {
  return (rawWindows ?? []).map(w => {
    if (w.allDay) return { dayOfWeek: w.dayOfWeek, startMinute: null, endMinute: null, allDay: true };
    const [sh, sm] = String(w.startTime).split(":").map(Number);
    const [eh, em] = String(w.endTime).split(":").map(Number);
    return { dayOfWeek: w.dayOfWeek, startMinute: sh * 60 + sm, endMinute: eh * 60 + em, allDay: false };
  });
}

/**
 * Construye los segmentos CONTRACT de un equipo para el intervalo de la
 * tarea, usando el resultado de contract-resolver.js.
 */
function buildContractSegments(startUtcMs, endUtcMs, resolution, holidayLookup) {
  if (!resolution.calculable) {
    // Falla en match/versión/estado/schedule (pasos 1-4 de la cascada), NUNCA
    // en el calendario -pero el CHECK real de sql/081 exige que
    // holiday_coverage_status='COVERAGE_UNKNOWN' solo coexista con
    // segment_reason_code='HOLIDAY_COVERAGE_UNKNOWN'. El estado de feriado
    // es independiente de si el equipo/contrato resolvió, así que se
    // consulta igual (holidayLookup es puro, no depende de la resolución
    // contractual) -se preserva resolution.reasonCode como causa real salvo
    // en el caso compuesto (calendario también desconocido para la fecha),
    // estructuralmente prevenido por la cobertura completa de 6.6B1 para
    // todo el rango histórico procesado, pero cubierto igual por seguridad.
    const localDate = localDateStringAt(startUtcMs);
    const dayOfWeek = dayOfWeekAt(startUtcMs);
    const holidayStatus = holidayLookup(localDate);
    const isHoliday = holidayStatus === "CONFIRMED_HOLIDAY" ? true : holidayStatus === "CONFIRMED_NOT_HOLIDAY" ? false : null;
    return [{
      segmentStartUtcMs: startUtcMs, segmentEndUtcMs: endUtcMs, localDate, dayOfWeek,
      segmentSeconds: Math.round((endUtcMs - startUtcMs) / 1000),
      holidayCoverageStatus: holidayStatus, isHoliday,
      segmentCalculationStatus: "NOT_CALCULABLE", segmentCoverageState: "NOT_CALCULABLE",
      segmentReasonCode: holidayStatus === "COVERAGE_UNKNOWN" ? "HOLIDAY_COVERAGE_UNKNOWN" : resolution.reasonCode,
      outsideCoverageBucket: null, coveredSeconds: null, outsideCoverageSeconds: null
    }];
  }

  const windows = toMinuteWindows(resolution.windows);
  const validFromUtcMs = resolution.validFrom ? Date.parse(`${resolution.validFrom}T00:00:00Z`) : null;
  const validToUtcMs = resolution.validTo ? Date.parse(`${resolution.validTo}T00:00:00Z`) : null;
  const rawSegments = partitionInterval(startUtcMs, endUtcMs, windows, { validFromUtcMs, validToUtcMs });

  return rawSegments.map(seg => {
    const segmentSeconds = Math.round((seg.endUtcMs - seg.startUtcMs) / 1000);
    const holidayStatus = holidayLookup(seg.localDate);

    if (holidayStatus === "COVERAGE_UNKNOWN") {
      return { segmentStartUtcMs: seg.startUtcMs, segmentEndUtcMs: seg.endUtcMs, localDate: seg.localDate, dayOfWeek: seg.dayOfWeek, segmentSeconds, holidayCoverageStatus: "COVERAGE_UNKNOWN", isHoliday: null, segmentCalculationStatus: "NOT_CALCULABLE", segmentCoverageState: "NOT_CALCULABLE", segmentReasonCode: "HOLIDAY_COVERAGE_UNKNOWN", outsideCoverageBucket: null, coveredSeconds: null, outsideCoverageSeconds: null };
    }
    const isHoliday = holidayStatus === "CONFIRMED_HOLIDAY";
    const covered = !isHoliday && seg.withinWindow;
    const outsideCoverageBucket = covered ? null : (isHoliday ? "HOLIDAY" : (seg.dayOfWeek === "SAT" || seg.dayOfWeek === "SUN") ? "WEEKEND" : "AFTER_HOURS_WEEKDAY");
    return {
      segmentStartUtcMs: seg.startUtcMs, segmentEndUtcMs: seg.endUtcMs, localDate: seg.localDate, dayOfWeek: seg.dayOfWeek, segmentSeconds,
      holidayCoverageStatus: isHoliday ? "CONFIRMED_HOLIDAY" : "CONFIRMED_NOT_HOLIDAY", isHoliday,
      segmentCalculationStatus: "CALCULATED", segmentCoverageState: covered ? "COVERED" : "OUTSIDE_COVERAGE", segmentReasonCode: "WITHIN_MATCHED_CONTRACT",
      outsideCoverageBucket, coveredSeconds: covered ? segmentSeconds : 0, outsideCoverageSeconds: covered ? 0 : segmentSeconds
    };
  });
}

/**
 * Construye el resultado completo de UNA tarea, siguiendo la cascada.
 * @param {object} params
 * @param {object} params.task { startTimeRaw, reportedStartRaw, reportedEndRaw, durationMinutes, clientKey, taskType, assignedTo }
 * @param {object} params.confidenceContext { businessHoursStatus, holidaysStatus }
 * @param {{ fieldbeatEquipmentKey: string, match: object|null, versions: object[], scheduleByVersionId: Map, windowsByScheduleId: Map }[]} params.equipmentInputs
 * @param {(localDate:string) => string} params.holidayLookup
 * @param {object} params.businessHoursCfg -para el fallback LEGACY_GLOBAL (mismo horario global)
 * @returns {object} fila lista para persistir en Capa C + segmentos de Capa B + filas de bridge
 */
export function buildTaskCoverage({ task, confidenceContext, equipmentInputs, holidayLookup, businessHoursCfg }) {
  const interval = resolveInterval({ startTimeRaw: task.startTimeRaw, reportedStartRaw: task.reportedStartRaw, reportedEndRaw: task.reportedEndRaw, durationMinutes: task.durationMinutes });
  const confidence = calculateConfidence(
    { startTimeRaw: task.startTimeRaw, durationMinutes: task.durationMinutes, clientKey: task.clientKey, taskType: task.taskType, assignedTo: task.assignedTo },
    { businessHoursStatus: confidenceContext.businessHoursStatus, holidaysStatus: confidenceContext.holidaysStatus, reportedEvaluation: interval.reportedEvaluation }
  );

  // 1) Intervalo no resoluble -> NONE inmediato, sin segmentos de ningún tipo.
  if (isIntervalTerminal(interval.reasonCode)) {
    return {
      dataBasis: "NONE", fallbackUsed: false,
      calculationStatus: "NOT_CALCULABLE", coverageClassification: "NOT_CALCULABLE", coverageReasonCode: interval.reasonCode,
      contractualAttemptStatus: "NOT_CALCULABLE", contractualCoverageClassification: "NOT_CALCULABLE", contractualReasonCode: interval.reasonCode,
      startTimeUtc: null, endTimeUtc: null, durationSeconds: null,
      coveredSeconds: null, outsideCoverageSeconds: null, afterHoursWeekdaySeconds: null, weekendSeconds: null, holidaySeconds: null, afterHoursTotalSeconds: null, afterHoursRate: null, isAfterHoursTask: null,
      confidenceScore: null, confidenceLabel: null, confidenceFactors: null, calculationMethod: interval.method,
      contractResolutionConfidence: null, contractResolutionLabel: null,
      equipmentLinks: [], segments: []
    };
  }

  const startUtcMs = interval.startTimeUtc.getTime();
  const endUtcMs = interval.endTimeUtc.getTime();

  // 2) Intento CONTRACTUAL, por equipo.
  const allSegments = [];
  const equipmentResults = equipmentInputs.map(eq => {
    const resolution = resolveEquipmentContract({ fieldbeatEquipmentKey: eq.fieldbeatEquipmentKey, taskLocalDate: interval.startTimeUtc.toISOString().slice(0, 10), match: eq.match, versions: eq.versions, scheduleByVersionId: eq.scheduleByVersionId, windowsByScheduleId: eq.windowsByScheduleId });
    const segments = buildContractSegments(startUtcMs, endUtcMs, resolution, holidayLookup);
    for (const s of segments) allSegments.push({ ...s, fieldbeatEquipmentKey: eq.fieldbeatEquipmentKey, scheduleSource: "CONTRACT", contractEquipmentKey: resolution.contractEquipmentKey, contractVersionId: resolution.contractVersionId, scheduleId: resolution.scheduleId, coverageType: resolution.coverageType, parseStatus: resolution.parseStatus, matchStatus: resolution.matchStatus });

    const coveredIntervals = segments.filter(s => s.segmentCoverageState === "COVERED").map(s => ({ startUtc: new Date(s.segmentStartUtcMs), endUtc: new Date(s.segmentEndUtcMs) }));
    const anyNotCalculable = segments.some(s => s.segmentCoverageState === "NOT_CALCULABLE");
    const aggregate = aggregateSegments(segments);

    return {
      fieldbeatEquipmentKey: eq.fieldbeatEquipmentKey, resolution, segments, aggregate,
      calculable: !anyNotCalculable, coverageFingerprint: anyNotCalculable ? null : computeCoverageFingerprint(coveredIntervals),
      equipmentCoverageClassification: anyNotCalculable ? "NOT_CALCULABLE" : aggregate.coverageClassification,
      equipmentReasonCode: anyNotCalculable ? (segments.find(s => s.segmentCoverageState === "NOT_CALCULABLE")?.segmentReasonCode ?? resolution.reasonCode) : "WITHIN_MATCHED_CONTRACT"
    };
  });

  let contractualAttemptStatus, contractualCoverageClassification, contractualReasonCode, primaryEquipmentKey = null, contractualAggregate = null;

  if (equipmentResults.length === 0) {
    contractualAttemptStatus = "NOT_CALCULABLE"; contractualCoverageClassification = "NOT_CALCULABLE"; contractualReasonCode = "NO_EQUIPMENT";
  } else {
    const multiEval = evaluateMultiEquipmentEquivalence(equipmentResults.map(e => ({ fieldbeatEquipmentKey: e.fieldbeatEquipmentKey, coverageFingerprint: e.coverageFingerprint, calculable: e.calculable })));
    if (multiEval.outcome === "SINGLE_EQUIPMENT" && equipmentResults[0].calculable) {
      contractualAttemptStatus = "CALCULATED"; contractualCoverageClassification = equipmentResults[0].equipmentCoverageClassification; contractualReasonCode = "WITHIN_MATCHED_CONTRACT";
      primaryEquipmentKey = equipmentResults[0].fieldbeatEquipmentKey; contractualAggregate = equipmentResults[0].aggregate;
    } else if (multiEval.outcome === "MULTIPLE_EQUIPMENT_SAME_COVERAGE") {
      contractualAttemptStatus = "CALCULATED"; contractualCoverageClassification = equipmentResults[0].equipmentCoverageClassification; contractualReasonCode = "MULTIPLE_EQUIPMENT_SAME_COVERAGE";
      primaryEquipmentKey = multiEval.primaryEquipmentKey; contractualAggregate = equipmentResults.find(e => e.fieldbeatEquipmentKey === primaryEquipmentKey).aggregate;
    } else if (multiEval.outcome === "MULTIPLE_EQUIPMENT_CONFLICT") {
      contractualAttemptStatus = "NOT_CALCULABLE"; contractualCoverageClassification = "NOT_CALCULABLE"; contractualReasonCode = "MULTIPLE_EQUIPMENT_CONFLICT";
    } else {
      // SINGLE_EQUIPMENT no calculable.
      contractualAttemptStatus = "NOT_CALCULABLE"; contractualCoverageClassification = "NOT_CALCULABLE"; contractualReasonCode = equipmentResults[0].equipmentReasonCode;
    }
  }

  const equipmentLinks = equipmentResults.map(e => ({
    fieldbeatEquipmentKey: e.fieldbeatEquipmentKey, contractEquipmentKey: e.resolution.contractEquipmentKey, contractVersionId: e.resolution.contractVersionId, scheduleId: e.resolution.scheduleId,
    contractValidFrom: e.resolution.validFrom, contractValidTo: e.resolution.validTo, matchStatus: e.resolution.matchStatus, parseStatus: e.resolution.parseStatus,
    equipmentCoverageClassification: e.equipmentCoverageClassification, equipmentReasonCode: e.equipmentReasonCode, coverageFingerprint: e.coverageFingerprint,
    isPrimary: e.fieldbeatEquipmentKey === primaryEquipmentKey
  }));

  const contractualSuccess = contractualAttemptStatus === "CALCULATED";

  if (contractualSuccess) {
    const primaryResolution = equipmentResults.find(e => e.fieldbeatEquipmentKey === primaryEquipmentKey).resolution;
    const contractResolutionConfidence = calculateContractResolutionConfidence({
      matchMethod: primaryResolution.matchMethod ?? "SERIAL_SUFFIX",
      coverageType: primaryResolution.coverageType,
      multiEquipmentOutcome: contractualReasonCode === "MULTIPLE_EQUIPMENT_SAME_COVERAGE" ? "MULTIPLE_EQUIPMENT_SAME_COVERAGE" : "SINGLE_EQUIPMENT"
    });

    return {
      dataBasis: "CONTRACTUAL", fallbackUsed: false,
      calculationStatus: "CALCULATED", coverageClassification: contractualCoverageClassification, coverageReasonCode: contractualReasonCode,
      contractualAttemptStatus, contractualCoverageClassification, contractualReasonCode,
      startTimeUtc: interval.startTimeUtc, endTimeUtc: interval.endTimeUtc, durationSeconds: interval.durationSeconds,
      ...pickAggregateSeconds(contractualAggregate),
      confidenceScore: confidence.score, confidenceLabel: confidence.label, confidenceFactors: confidence.factors, calculationMethod: interval.method,
      contractResolutionConfidence: contractResolutionConfidence.score, contractResolutionLabel: contractResolutionConfidence.label,
      primaryEquipmentKey, equipmentLinks, segments: allSegments
    };
  }

  // 3) Fallback LEGACY_SCHEDULE (tarea completa, sin distinción de equipo).
  const legacySegments = segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, holidayLookup);
  const legacyAggregate = aggregateSegments(legacySegments);
  for (const s of legacySegments) allSegments.push({ ...s, fieldbeatEquipmentKey: null, scheduleSource: "LEGACY_GLOBAL", contractEquipmentKey: null, contractVersionId: null, scheduleId: null, coverageType: null, parseStatus: null, matchStatus: null });

  if (legacyAggregate.calculable) {
    return {
      dataBasis: "LEGACY_SCHEDULE", fallbackUsed: true,
      calculationStatus: interval.method === "PARTIAL_ESTIMATE" ? "CALCULATED_WITH_WARNINGS" : "CALCULATED", coverageClassification: legacyAggregate.coverageClassification, coverageReasonCode: "WITHIN_LEGACY_SCHEDULE",
      contractualAttemptStatus, contractualCoverageClassification, contractualReasonCode,
      startTimeUtc: interval.startTimeUtc, endTimeUtc: interval.endTimeUtc, durationSeconds: interval.durationSeconds,
      ...pickAggregateSeconds(legacyAggregate),
      confidenceScore: confidence.score, confidenceLabel: confidence.label, confidenceFactors: confidence.factors, calculationMethod: interval.method,
      contractResolutionConfidence: null, contractResolutionLabel: null,
      primaryEquipmentKey: null, equipmentLinks, segments: allSegments
    };
  }

  // 4) Ambos fallan -> NONE (intervalo sí se resolvió, se conserva).
  return {
    dataBasis: "NONE", fallbackUsed: false,
    calculationStatus: "NOT_CALCULABLE", coverageClassification: "NOT_CALCULABLE", coverageReasonCode: contractualReasonCode,
    contractualAttemptStatus, contractualCoverageClassification, contractualReasonCode,
    startTimeUtc: interval.startTimeUtc, endTimeUtc: interval.endTimeUtc, durationSeconds: interval.durationSeconds,
    coveredSeconds: null, outsideCoverageSeconds: null, afterHoursWeekdaySeconds: null, weekendSeconds: null, holidaySeconds: null, afterHoursTotalSeconds: null, afterHoursRate: null, isAfterHoursTask: null,
    confidenceScore: null, confidenceLabel: null, confidenceFactors: null, calculationMethod: interval.method,
    contractResolutionConfidence: null, contractResolutionLabel: null,
    primaryEquipmentKey: null, equipmentLinks, segments: allSegments
  };
}

function pickAggregateSeconds(agg) {
  return {
    coveredSeconds: agg.coveredSeconds, outsideCoverageSeconds: agg.outsideCoverageSeconds,
    afterHoursWeekdaySeconds: agg.afterHoursWeekdaySeconds, weekendSeconds: agg.weekendSeconds, holidaySeconds: agg.holidaySeconds,
    afterHoursTotalSeconds: agg.afterHoursTotalSeconds, afterHoursRate: agg.afterHoursRate, isAfterHoursTask: agg.isAfterHoursTask
  };
}

export { mergeIntervals };
