import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";
import { aggregateMetricConfidence, getConfidenceLabel } from "../lib/calculation-confidence.js";

const MART_FILE = "data/marts/FieldBeat_Working_Hours_Analysis.csv";
const OUTPUT_DIR = "data/gold";
const BUILD_SUMMARY_FILE = "data/reports/after_hours_gold_build_summary.json";

function num(value) {
  return Number(value || 0);
}

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

// Derivado de start_time_local (YYYY-MM-DD HH:mm:ss, ya en hora de Chile -
// ver src/lib/business-hours.js), no de start_time_utc, para que el
// período calce con el día calendario que el negocio percibe como "el mes
// en que pasó la tarea".
function toPeriod(startTimeLocal) {
  const value = String(startTimeLocal ?? "").trim();
  if (!value) return "(sin fecha)";
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "(fecha inválida)";
}

// Columnas meta compartidas por las 5 tablas GOLD (ver
// docs/CALCULATION_CONFIDENCE_MODEL.md § agregación a nivel KPI/GOLD).
function computeMetaColumns(rows) {
  const exactRows = rows.filter(r => r.calculation_method === "EXACT_REPORTED_START_END").length;
  const estimatedRows = rows.filter(
    r => r.calculation_method === "ESTIMATED_FROM_START_DURATION" || r.calculation_method === "PARTIAL_ESTIMATE"
  ).length;
  const insufficientRows = rows.filter(r => r.calculation_method === "INSUFFICIENT_DATA").length;
  const invalidRows = rows.filter(r => r.calculation_status === "NOT_CALCULABLE").length;
  const validRows = rows.length - invalidRows;

  const hoursConfidence = aggregateMetricConfidence(rows, "hours");

  return {
    confidence_score: hoursConfidence.score,
    confidence_label: hoursConfidence.label,
    confidence_factors_summary:
      `Basado en ${rows.length} tareas: ${exactRows} cálculo exacto, ${estimatedRows} estimado, ` +
      `${invalidRows} no calculable. Confianza ponderada por horas: ${hoursConfidence.score} (${hoursConfidence.label}).`,
    valid_rows: validRows,
    invalid_rows: invalidRows,
    estimated_rows: estimatedRows,
    exact_rows: exactRows,
    insufficient_rows: insufficientRows
  };
}

// GOLD_After_Hours_Work_Analysis.csv (1 fila global) - los 6 KPIs de la
// vista, cada uno con su propio valor + confianza lado a lado. KPI 1-4 usan
// confianza ponderada por duration_minutes sobre el universo completo de
// tareas (simplificación deliberada: se usa el score de 6 factores
// completo de cada tarea, no una fórmula parcial bespoke por KPI - ver
// docs/CALCULATION_CONFIDENCE_MODEL.md). KPI 5 usa promedio simple sobre
// solo las tareas con trabajo fuera de horario. KPI 6 no promedia la
// confianza de las filas no calculables (eso mediría al revés) - usa un
// valor fijo alto, penalizado solo si calculation_status viniera vacío.
function buildWorkAnalysis(rows) {
  const totalDurationMinutes = rows.reduce((sum, r) => sum + num(r.duration_minutes), 0);
  const totalBusinessMinutes = rows.reduce((sum, r) => sum + num(r.business_minutes), 0);
  const totalAfterHoursMinutes = rows.reduce((sum, r) => sum + num(r.after_hours_total_minutes), 0);
  const tasksWithAfterHours = rows.filter(r => isTrue(r.is_after_hours_task));
  const tasksNotCalculable = rows.filter(r => r.calculation_status === "NOT_CALCULABLE").length;
  const blankStatusCount = rows.filter(r => !String(r.calculation_status ?? "").trim()).length;

  const hoursConfidence = aggregateMetricConfidence(rows, "hours");
  const kpi5Confidence = aggregateMetricConfidence(tasksWithAfterHours, "count");
  const kpi6Score = blankStatusCount === 0 ? 95 : Math.max(0, 95 - blankStatusCount * 5);
  const kpi6Label = getConfidenceLabel(kpi6Score).label;

  const afterHoursRate = totalDurationMinutes > 0 ? totalAfterHoursMinutes / totalDurationMinutes : 0;

  const meta = computeMetaColumns(rows);

  return [
    {
      kpi1_total_hours: round2(totalDurationMinutes / 60),
      kpi1_confidence_score: hoursConfidence.score,
      kpi1_confidence_label: hoursConfidence.label,
      kpi2_business_hours: round2(totalBusinessMinutes / 60),
      kpi2_confidence_score: hoursConfidence.score,
      kpi2_confidence_label: hoursConfidence.label,
      kpi3_after_hours_hours: round2(totalAfterHoursMinutes / 60),
      kpi3_confidence_score: hoursConfidence.score,
      kpi3_confidence_label: hoursConfidence.label,
      kpi4_after_hours_rate: afterHoursRate.toFixed(4),
      kpi4_confidence_score: hoursConfidence.score,
      kpi4_confidence_label: hoursConfidence.label,
      kpi5_tasks_with_after_hours: tasksWithAfterHours.length,
      kpi5_confidence_score: kpi5Confidence.score,
      kpi5_confidence_label: kpi5Confidence.label,
      kpi6_tasks_not_calculable: tasksNotCalculable,
      kpi6_confidence_score: kpi6Score,
      kpi6_confidence_label: kpi6Label,
      ...meta
    }
  ];
}

function buildByDimension(rows, keyField, keyValueOf, extraKeyFields = () => ({})) {
  const groups = new Map();

  for (const row of rows) {
    const keyValue = keyValueOf(row);
    if (!keyValue) continue;

    if (!groups.has(keyValue)) groups.set(keyValue, []);
    groups.get(keyValue).push(row);
  }

  const result = [];

  for (const [keyValue, groupRows] of groups.entries()) {
    const totalMinutes = groupRows.reduce((sum, r) => sum + num(r.duration_minutes), 0);
    const businessMinutes = groupRows.reduce((sum, r) => sum + num(r.business_minutes), 0);
    const afterHoursMinutes = groupRows.reduce((sum, r) => sum + num(r.after_hours_total_minutes), 0);
    const tasksWithAfterHours = groupRows.filter(r => isTrue(r.is_after_hours_task)).length;

    result.push({
      [keyField]: keyValue,
      ...extraKeyFields(groupRows),
      total_hours: round2(totalMinutes / 60),
      business_hours: round2(businessMinutes / 60),
      after_hours_total_hours: round2(afterHoursMinutes / 60),
      after_hours_rate: totalMinutes > 0 ? (afterHoursMinutes / totalMinutes).toFixed(4) : "0.0000",
      tasks_total: groupRows.length,
      tasks_with_after_hours: tasksWithAfterHours,
      ...computeMetaColumns(groupRows)
    });
  }

  return result.sort((a, b) => b.after_hours_total_hours - a.after_hours_total_hours);
}

async function buildAfterHoursGold() {
  console.log("=== Construyendo GOLD Trabajo Fuera de Horario ===");

  const rows = await readCsv(MART_FILE);
  console.log(`Tareas (mart working hours): ${rows.length}`);

  const outputs = [
    { file: `${OUTPUT_DIR}/GOLD_After_Hours_Work_Analysis.csv`, rows: buildWorkAnalysis(rows) },
    {
      file: `${OUTPUT_DIR}/GOLD_After_Hours_By_Client.csv`,
      rows: buildByDimension(
        rows,
        "client_name",
        r => String(r.client_name ?? "").trim(),
        groupRows => ({ client_rut: groupRows[0]?.client_rut || "" })
      )
    },
    {
      file: `${OUTPUT_DIR}/GOLD_After_Hours_By_Task_Type.csv`,
      rows: buildByDimension(rows, "task_type", r => String(r.task_type ?? "").trim())
    },
    {
      file: `${OUTPUT_DIR}/GOLD_After_Hours_By_Technician.csv`,
      rows: buildByDimension(rows, "assigned_to", r => String(r.assigned_to ?? "").trim())
    },
    {
      file: `${OUTPUT_DIR}/GOLD_After_Hours_By_Period.csv`,
      rows: buildByDimension(rows, "period", r => toPeriod(r.start_time_local))
    }
  ];

  for (const output of outputs) {
    await writeCsv(output.file, output.rows);
  }

  const buildSummary = {
    generated_at: new Date().toISOString(),
    inputs_used: [MART_FILE],
    outputs: outputs.map(o => ({ file: o.file, row_count: o.rows.length })),
    global_after_hours_rate: percent(
      rows.reduce((sum, r) => sum + num(r.after_hours_total_minutes), 0),
      rows.reduce((sum, r) => sum + num(r.duration_minutes), 0)
    )
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(BUILD_SUMMARY_FILE, JSON.stringify(buildSummary, null, 2), "utf8");

  console.log(JSON.stringify(buildSummary, null, 2));
  console.log(`Resumen de build guardado en ${BUILD_SUMMARY_FILE}`);
  console.log("=== GOLD Trabajo Fuera de Horario finalizado ===");
}

buildAfterHoursGold().catch(error => {
  console.error("ERROR CONSTRUYENDO GOLD TRABAJO FUERA DE HORARIO:");
  console.error(error);
  process.exit(1);
});
