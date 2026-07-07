import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";
import { getConfidenceLabel } from "../lib/calculation-confidence.js";

// Línea "Vida Útil de Repuestos por Máquina" (ver
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md). Este mart es INFERENCIA
// PRELIMINAR: no existe en los datos un evento explícito de "instalación"
// o "reemplazo" de un repuesto en una máquina - se infiere cruzando la task
// FieldBeat (fecha + tipo), el/los equipo(s) asociados a esa task, y el/los
// repuesto(s) usados ya resueltos contra Dolibarr.

const TASKS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv";
const TASK_EQUIPMENTS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Task_Equipments.csv";
const USED_PARTS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Used_Parts.csv";
const MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";
const REPORT_MART_FILE = "data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv";
const WORKING_HOURS_FILE = "data/marts/FieldBeat_Working_Hours_Analysis.csv";

const OUTPUT_FILE = "data/marts/Equipment_Part_Lifecycle_Events.csv";
const SUMMARY_FILE = "data/reports/equipment_part_lifecycle_events_summary.json";

// Heurísticas de texto para event_type_inferred - deliberadamente simples
// (substring, sin acentos normalizados) y ajustables. Documentadas en
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md como reglas de v1, no un
// clasificador entrenado.
const CORRECTIVE_KEYWORDS = ["correctiv", "falla", "emergencia"];
const PREVENTIVE_KEYWORDS = ["preventiv", "mantenc", "mantenim"];
const CONSUMABLE_KEYWORDS = [
  "consumible", "filtro", "gel", "papel", "guante", "alcohol", "aceite",
  "correa", "bateria", "batería", "lampara", "lámpara", "electrodo", "aguja"
];

const STRONG_MATCH_METHODS = new Set([
  "REF_EXACT", "BARCODE_EXACT", "ID_EXACT",
  "REF_NORMALIZED_EXACT", "BARCODE_NORMALIZED_EXACT", "MANUAL_ALIAS_EXACT"
]);

function cleanId(value) {
  return String(value ?? "").trim();
}

function num(value) {
  return Number(value || 0);
}

function containsAny(haystack, keywords) {
  const lower = haystack.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function isValidDate(raw) {
  if (!raw) return false;
  const ms = new Date(raw).getTime();
  return !Number.isNaN(ms);
}

function inferEventType({ taskType, partName, dolibarrLabel, matchStatus, quantity }) {
  const taskTypeText = String(taskType ?? "");
  if (containsAny(taskTypeText, CORRECTIVE_KEYWORDS)) return "CORRECTIVE_REPLACEMENT_LIKELY";
  if (containsAny(taskTypeText, PREVENTIVE_KEYWORDS)) return "PREVENTIVE_REPLACEMENT_LIKELY";

  const partText = `${partName ?? ""} ${dolibarrLabel ?? ""}`;
  if (containsAny(partText, CONSUMABLE_KEYWORDS)) return "CONSUMABLE_USAGE";

  if (matchStatus === "MATCHED" && quantity > 0) return "PART_USAGE_CONFIRMED";

  return "UNKNOWN";
}

// Score de asociación (0-100) de la tripleta task-equipo-repuesto - distinto
// del score de confiabilidad de vida útil (src/lib/lifecycle-confidence.js,
// que se calcula a nivel máquina+repuesto agregado). Este es local: ¿esta
// fila individual es una asociación confiable?
function calculateAssociationConfidence({ equipmentCount, matchStatus, matchMethod }) {
  let base;
  let equipmentReason;
  if (equipmentCount === 1) {
    base = 100;
    equipmentReason = "task con 1 solo equipo asociado";
  } else if (equipmentCount > 1) {
    base = 55;
    equipmentReason = `task con ${equipmentCount} equipos asociados (no hay certeza de a cuál corresponde el repuesto)`;
  } else {
    base = 20;
    equipmentReason = "task sin equipo asociado";
  }

  let multiplier;
  let matchReason;
  if (matchStatus === "MATCHED" && STRONG_MATCH_METHODS.has(matchMethod)) {
    multiplier = 1;
    matchReason = `match Dolibarr exacto/alias (${matchMethod})`;
  } else if (matchStatus === "MATCHED") {
    multiplier = 0.85;
    matchReason = `match Dolibarr por método débil (${matchMethod || "desconocido"})`;
  } else if (matchStatus === "AMBIGUOUS_MATCH") {
    multiplier = 0.4;
    matchReason = "match Dolibarr ambiguo (múltiples candidatos)";
  } else {
    multiplier = 0.2;
    matchReason = `sin match Dolibarr confiable (${matchStatus || "NO_MATCH"})`;
  }

  const score = Math.max(0, Math.min(100, Math.round(base * multiplier)));
  const { label } = getConfidenceLabel(score);

  return {
    score,
    label,
    factors: `${equipmentReason} | ${matchReason}`
  };
}

async function buildEquipmentPartLifecycleEvents() {
  console.log("=== Construyendo Equipment Part Lifecycle Events ===");

  const tasks = await readCsv(TASKS_FILE);
  const taskEquipments = await readCsv(TASK_EQUIPMENTS_FILE);
  const usedParts = await readCsv(USED_PARTS_FILE);
  const matchRows = await readCsv(MATCH_FILE);
  const reportMartRows = await readCsv(REPORT_MART_FILE);
  const workingHoursRows = await readCsv(WORKING_HOURS_FILE);

  console.log(`Tasks FieldBeat: ${tasks.length}`);
  console.log(`Relaciones task-equipo: ${taskEquipments.length}`);
  console.log(`Repuestos usados: ${usedParts.length}`);

  const equipmentsByTask = new Map();
  for (const row of taskEquipments) {
    const taskId = cleanId(row.fieldbeat_task_id);
    const equipmentId = cleanId(row.equipment_internal_id);
    if (!taskId || !equipmentId) continue;
    if (!equipmentsByTask.has(taskId)) equipmentsByTask.set(taskId, []);
    equipmentsByTask.get(taskId).push(equipmentId);
  }

  const usedPartsByTask = new Map();
  for (const row of usedParts) {
    const taskId = cleanId(row.fieldbeat_task_id);
    if (!taskId) continue;
    if (!usedPartsByTask.has(taskId)) usedPartsByTask.set(taskId, []);
    usedPartsByTask.get(taskId).push(row);
  }

  const matchByUsedPartId = new Map();
  for (const row of matchRows) {
    const usedPartId = cleanId(row.used_part_id);
    if (usedPartId) matchByUsedPartId.set(usedPartId, row);
  }

  const enrichmentByTask = new Map();
  for (const row of reportMartRows) {
    enrichmentByTask.set(cleanId(row.fieldbeat_task_id), row);
  }

  const workingHoursByTask = new Map();
  for (const row of workingHoursRows) {
    workingHoursByTask.set(cleanId(row.fieldbeat_task_id), row);
  }

  const outputRows = [];

  for (const task of tasks) {
    const taskId = cleanId(task.fieldbeat_task_id);
    const partsForTask = usedPartsByTask.get(taskId) || [];
    if (partsForTask.length === 0) continue; // sin repuestos, nada que rastrear para esta línea

    const equipmentIds = equipmentsByTask.get(taskId) || [];
    const equipmentList = equipmentIds.length > 0 ? equipmentIds : [""];

    const hasValidDate = isValidDate(task.start_time);
    const eventDate = hasValidDate ? cleanId(task.start_time) : "";

    let calculationStatus;
    if (!hasValidDate) calculationStatus = "MISSING_EVENT_DATE";
    else if (equipmentIds.length === 0) calculationStatus = "MISSING_EQUIPMENT";
    else calculationStatus = "OK";

    const enrichment = enrichmentByTask.get(taskId) || {};
    const workingHours = workingHoursByTask.get(taskId) || {};

    for (const equipmentId of equipmentList) {
      for (const part of partsForTask) {
        const usedPartId = cleanId(part.used_part_id);
        const match = matchByUsedPartId.get(usedPartId) || {};
        const matchStatus = match.match_status || "NO_MATCH";
        const matchMethod = match.match_method || "";
        const quantity = num(part.quantity);

        const association = calculateAssociationConfidence({
          equipmentCount: equipmentIds.length,
          matchStatus,
          matchMethod
        });

        const eventTypeInferred = inferEventType({
          taskType: task.task_type,
          partName: part.part_name,
          dolibarrLabel: match.dolibarr_label,
          matchStatus,
          quantity
        });

        const notes = [];
        if (calculationStatus === "MISSING_EVENT_DATE") notes.push("start_time ausente o inválido - no se puede fechar este evento");
        if (calculationStatus === "MISSING_EQUIPMENT") notes.push("la task no tiene equipo asociado en fieldbeat_task_equipments");
        if (equipmentIds.length > 1) notes.push(`la task tiene ${equipmentIds.length} equipos asociados - no hay certeza de a cuál corresponde este repuesto`);
        if (matchStatus !== "MATCHED") notes.push(`repuesto sin match confiable en Dolibarr (match_status=${matchStatus}) - excluido del cálculo de intervalos`);

        outputRows.push({
          lifecycle_event_id: `${taskId}_${equipmentId || "NOEQUIP"}_${usedPartId}`,
          fieldbeat_task_id: taskId,
          event_date: eventDate,
          client_key: task.client_key || "",
          client_name: enrichment.client_name || "",
          equipment_internal_id: equipmentId,
          equipment_uuid: "",
          task_type: task.task_type || "",
          task_state: enrichment.task_state || task.state || "",
          technician_names: enrichment.technician_names || task.assigned_to || "",
          linked_zendesk_ticket_id: task.linked_zendesk_ticket_id || enrichment.linked_zendesk_ticket_id || "",
          used_part_id: usedPartId,
          raw_part_identifier: match.raw_part_identifier || part.part_number || "",
          part_name: part.part_name || "",
          quantity: part.quantity || "",
          dolibarr_product_id: match.dolibarr_product_id || "",
          dolibarr_ref: match.dolibarr_ref || "",
          dolibarr_label: match.dolibarr_label || "",
          match_status: matchStatus,
          match_method: matchMethod,
          match_confidence: match.match_confidence ?? "",
          replacement_event_inferred: eventTypeInferred === "CORRECTIVE_REPLACEMENT_LIKELY" || eventTypeInferred === "PREVENTIVE_REPLACEMENT_LIKELY",
          event_type_inferred: eventTypeInferred,
          task_equipment_count: equipmentIds.length,
          association_confidence_score: association.score,
          association_confidence_label: association.label,
          association_confidence_factors: association.factors,
          after_hours_minutes: workingHours.after_hours_total_minutes ?? "",
          business_minutes: workingHours.business_minutes ?? "",
          calculation_status: calculationStatus,
          calculation_notes: notes.join(" | ")
        });
      }
    }
  }

  await writeCsv(OUTPUT_FILE, outputRows);

  const statusBreakdown = {};
  const eventTypeBreakdown = {};
  const matchStatusBreakdown = {};
  const associationLabelBreakdown = {};

  for (const row of outputRows) {
    statusBreakdown[row.calculation_status] = (statusBreakdown[row.calculation_status] || 0) + 1;
    eventTypeBreakdown[row.event_type_inferred] = (eventTypeBreakdown[row.event_type_inferred] || 0) + 1;
    matchStatusBreakdown[row.match_status] = (matchStatusBreakdown[row.match_status] || 0) + 1;
    associationLabelBreakdown[row.association_confidence_label] = (associationLabelBreakdown[row.association_confidence_label] || 0) + 1;
  }

  const usableForIntervals = outputRows.filter(r => r.match_status === "MATCHED" && r.calculation_status === "OK").length;

  const summary = {
    generated_at: new Date().toISOString(),
    total_events: outputRows.length,
    usable_for_intervals: usableForIntervals,
    calculation_status_breakdown: statusBreakdown,
    event_type_breakdown: eventTypeBreakdown,
    match_status_breakdown: matchStatusBreakdown,
    association_confidence_label_breakdown: associationLabelBreakdown
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log("=== Equipment Part Lifecycle Events finalizado ===");
}

buildEquipmentPartLifecycleEvents().catch(error => {
  console.error("ERROR CONSTRUYENDO EQUIPMENT PART LIFECYCLE EVENTS:");
  console.error(error);
  process.exit(1);
});
