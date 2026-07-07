import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";
import {
  utcIsoToLocalFakeMs,
  parseChileWallClock,
  classifyInterval,
  formatLocalFakeMs,
  loadBusinessHoursConfig,
  loadHolidaysConfig
} from "../lib/business-hours.js";
import { calculateTaskTimeConfidence, calculationStatusFromMethod } from "../lib/calculation-confidence.js";

const TASKS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv";
const REPORT_FIELDS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Report_Fields.csv";
const REPORT_MART_FILE = "data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv";

const OUTPUT_FILE = "data/marts/FieldBeat_Working_Hours_Analysis.csv";
const SUMMARY_FILE = "data/reports/fieldbeat_working_hours_analysis_summary.json";

// Solo el grupo base (no las copias numeradas "(1)".."(9)" de reportes
// multi-sesión - ver docs/AFTER_HOURS_METRICS.md § limitaciones, fuera de
// alcance en v1). Confirmado empíricamente: el grupo base siempre tiene
// group_index=1, is_group_copy=false, y a lo sumo 1 fila de cada campo de
// hora por task - no hace falta desambiguar duplicados.
const BASE_INTERVENTION_GROUP = "DESCRIPCIÓN DE LA INTERVENCIÓN";
const START_FIELD_NAME = "HORA DE INICIO DEL TRABAJO";
const END_FIELD_NAME = "HORA DE TERMINO DEL TRABAJO";

const REPORTED_SPAN_MAX_MINUTES = 1440;

function cleanId(value) {
  return String(value ?? "").trim();
}

function num(value) {
  return Number(value || 0);
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function buildReportedIntervalsByTask(reportFieldRows) {
  const starts = new Map();
  const ends = new Map();

  for (const row of reportFieldRows) {
    if (row.group_name !== BASE_INTERVENTION_GROUP) continue;
    const taskId = cleanId(row.fieldbeat_task_id);
    if (!taskId) continue;

    if (row.field_name === START_FIELD_NAME && cleanId(row.field_value)) {
      starts.set(taskId, cleanId(row.field_value));
    } else if (row.field_name === END_FIELD_NAME && cleanId(row.field_value)) {
      ends.set(taskId, cleanId(row.field_value));
    }
  }

  const intervals = new Map();
  for (const [taskId, startRaw] of starts.entries()) {
    const endRaw = ends.get(taskId);
    if (!endRaw) continue;

    intervals.set(taskId, {
      startRaw,
      endRaw,
      startMs: parseChileWallClock(startRaw),
      endMs: parseChileWallClock(endRaw)
    });
  }

  return intervals;
}

// Filtro de plausibilidad (ver docs/CALCULATION_CONFIDENCE_MODEL.md): el
// par HORA DE INICIO/TERMINO DEL TRABAJO reportado por el técnico solo se
// acepta como "hora real de término" si describe una ventana creíble - en
// la práctica, la mayoría de los pares reportados NO calzan con
// duration_minutes (hallazgo empírico: hasta 253 días de diferencia en
// algunos casos). Si falla, el par se guarda igual en
// reported_start_raw/reported_end_raw (transparencia) pero se descarta
// para el cálculo, cayendo a ESTIMATED_FROM_START_DURATION/PARTIAL_ESTIMATE.
function evaluateReportedInterval(interval, durationMinutes) {
  if (!interval || interval.startMs === null || interval.endMs === null) {
    return { plausible: false, reason: "sin par reportado o formato inválido" };
  }

  if (!(interval.endMs > interval.startMs)) {
    return { plausible: false, reason: "hora de término reportada es anterior o igual a la de inicio" };
  }

  const spanMinutes = (interval.endMs - interval.startMs) / 60000;

  if (spanMinutes > REPORTED_SPAN_MAX_MINUTES) {
    return { plausible: false, reason: `lapso reportado (${Math.round(spanMinutes)} min) cruza más de un día calendario` };
  }

  if (!(durationMinutes > 0)) {
    return { plausible: false, reason: "duration_minutes inválido, no se puede contrastar plausibilidad" };
  }

  const tolerance = Math.max(60, 0.5 * durationMinutes);
  if (Math.abs(spanMinutes - durationMinutes) > tolerance) {
    return {
      plausible: false,
      reason: `lapso reportado (${Math.round(spanMinutes)} min) difiere de duration_minutes (${durationMinutes} min) más allá de la tolerancia (±${Math.round(tolerance)} min)`
    };
  }

  return { plausible: true, reason: "lapso reportado consistente con duration_minutes" };
}

async function buildFieldBeatWorkingHoursAnalysis() {
  console.log("=== Construyendo FieldBeat Working Hours Analysis ===");

  const tasks = await readCsv(TASKS_FILE);
  const reportFieldRows = await readCsv(REPORT_FIELDS_FILE);
  const reportMartRows = await readCsv(REPORT_MART_FILE);

  console.log(`Tasks FieldBeat: ${tasks.length}`);
  console.log(`Filas de report_fields: ${reportFieldRows.length}`);

  const businessHoursCfg = await loadBusinessHoursConfig();
  const holidaysCfg = await loadHolidaysConfig();

  console.log(`Calendario laboral: ${businessHoursCfg.status}`);
  console.log(`Feriados: ${holidaysCfg.status} (${holidaysCfg.dates.size} fechas)`);

  const reportedIntervals = buildReportedIntervalsByTask(reportFieldRows);

  const enrichmentByTaskId = new Map();
  for (const row of reportMartRows) {
    enrichmentByTaskId.set(cleanId(row.fieldbeat_task_id), row);
  }

  const baseContext = {
    businessHoursStatus: businessHoursCfg.status,
    holidaysStatus: holidaysCfg.status
  };

  const outputRows = tasks.map(task => {
    const taskId = cleanId(task.fieldbeat_task_id);
    const enrichment = enrichmentByTaskId.get(taskId) || {};

    const durationMinutes = num(task.duration_minutes);
    const startLocalMs = utcIsoToLocalFakeMs(task.start_time);
    const rawInterval = reportedIntervals.get(taskId) || null;
    const evaluation = evaluateReportedInterval(rawInterval, durationMinutes);

    const taskContext = {
      ...baseContext,
      reportedInterval:
        rawInterval && rawInterval.startMs !== null && rawInterval.endMs !== null
          ? { startMs: rawInterval.startMs, endMs: rawInterval.endMs, plausible: evaluation.plausible }
          : null
    };

    const confidence = calculateTaskTimeConfidence(task, taskContext);
    const calculationStatus = calculationStatusFromMethod(confidence.method);

    let intervalStartMs = null;
    let intervalEndMs = null;
    let estimatedEndLocalMs = null;
    const notes = [];

    if (confidence.method === "EXACT_REPORTED_START_END") {
      intervalStartMs = rawInterval.startMs;
      intervalEndMs = rawInterval.endMs;
    } else if (startLocalMs !== null && durationMinutes > 0) {
      intervalStartMs = startLocalMs;
      intervalEndMs = startLocalMs + durationMinutes * 60000;
      estimatedEndLocalMs = intervalEndMs;
    }

    if (rawInterval && !evaluation.plausible) {
      notes.push(`hora de término reportada descartada: ${evaluation.reason}`);
    }
    if (confidence.method === "INVALID_START_TIME") notes.push("start_time ausente o inválido - no se pudo calcular ningún intervalo");
    if (confidence.method === "INVALID_DURATION") notes.push("duration_minutes ausente, cero o negativo - no se pudo estimar intervalo");
    if (confidence.method === "INSUFFICIENT_DATA") notes.push("datos insuficientes para cualquier cálculo");

    let classification = { business_minutes: 0, after_hours_weekday_minutes: 0, weekend_minutes: 0, holiday_minutes: 0 };
    if (intervalStartMs !== null && intervalEndMs !== null && intervalEndMs > intervalStartMs) {
      classification = classifyInterval(intervalStartMs, intervalEndMs, businessHoursCfg, holidaysCfg);
    }

    const afterHoursTotalMinutes =
      classification.after_hours_weekday_minutes + classification.weekend_minutes + classification.holiday_minutes;
    const usedDurationMinutes =
      intervalStartMs !== null && intervalEndMs !== null ? (intervalEndMs - intervalStartMs) / 60000 : 0;
    const afterHoursRate = usedDurationMinutes > 0 ? afterHoursTotalMinutes / usedDurationMinutes : 0;

    return {
      fieldbeat_task_id: taskId,
      client_key: task.client_key || "",
      client_rut: enrichment.client_rut || "",
      client_name: enrichment.client_name || "",
      task_type: task.task_type || "",
      assigned_to: task.assigned_to || "",
      equipment_internal_ids: enrichment.equipment_internal_ids || "",
      start_time_utc: task.start_time || "",
      start_time_local: startLocalMs !== null ? formatLocalFakeMs(startLocalMs) : "",
      duration_minutes: task.duration_minutes || "",
      reported_start_raw: rawInterval?.startRaw || "",
      reported_end_raw: rawInterval?.endRaw || "",
      reported_interval_plausible: rawInterval ? evaluation.plausible : "",
      estimated_end_time_local: estimatedEndLocalMs !== null ? formatLocalFakeMs(estimatedEndLocalMs) : "",
      business_minutes: Math.round(classification.business_minutes),
      after_hours_weekday_minutes: Math.round(classification.after_hours_weekday_minutes),
      weekend_minutes: Math.round(classification.weekend_minutes),
      holiday_minutes: Math.round(classification.holiday_minutes),
      after_hours_total_minutes: Math.round(afterHoursTotalMinutes),
      after_hours_rate: afterHoursRate.toFixed(4),
      is_after_hours_task: afterHoursTotalMinutes > 0,
      calculation_method: confidence.method,
      calculation_status: calculationStatus,
      calculation_notes: notes.join(" | "),
      confidence_score: confidence.score,
      confidence_label: confidence.label,
      confidence_color: confidence.color,
      confidence_factors: confidence.factors
    };
  });

  await writeCsv(OUTPUT_FILE, outputRows);

  const methodBreakdown = {};
  const statusBreakdown = {};
  const confidenceBreakdown = {};
  let rateViolations = 0;
  let scoreViolations = 0;
  let totalDuration = 0;
  let totalAfterHours = 0;

  for (const row of outputRows) {
    methodBreakdown[row.calculation_method] = (methodBreakdown[row.calculation_method] || 0) + 1;
    statusBreakdown[row.calculation_status] = (statusBreakdown[row.calculation_status] || 0) + 1;
    confidenceBreakdown[row.confidence_label] = (confidenceBreakdown[row.confidence_label] || 0) + 1;

    const rate = Number(row.after_hours_rate);
    if (rate > 1 || rate < 0) rateViolations += 1;

    const score = Number(row.confidence_score);
    if (score < 0 || score > 100) scoreViolations += 1;

    totalDuration += num(row.duration_minutes);
    totalAfterHours += num(row.after_hours_total_minutes);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    total_tasks: outputRows.length,
    business_hours_config_status: businessHoursCfg.status,
    holidays_config_status: holidaysCfg.status,
    holidays_dates_loaded: holidaysCfg.dates.size,
    calculation_method_breakdown: methodBreakdown,
    calculation_status_breakdown: statusBreakdown,
    confidence_label_breakdown: confidenceBreakdown,
    global_after_hours_rate: percent(totalAfterHours, totalDuration),
    self_check: {
      after_hours_rate_always_between_0_and_1: rateViolations === 0,
      after_hours_rate_violations: rateViolations,
      confidence_score_always_between_0_and_100: scoreViolations === 0,
      confidence_score_violations: scoreViolations
    }
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log("=== FieldBeat Working Hours Analysis finalizado ===");
}

buildFieldBeatWorkingHoursAnalysis().catch(error => {
  console.error("ERROR CONSTRUYENDO FIELDBEAT WORKING HOURS ANALYSIS:");
  console.error(error);
  process.exit(1);
});
