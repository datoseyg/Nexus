import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";

const TASKS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv";
const EQUIPMENTS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Task_Equipments.csv";
const BRIDGE_FILE = "data/processed/fieldbeat/BR_Ticket_FieldBeat_Task.csv";
const ZENDESK_TICKETS_FILE = "data/processed/zendesk/DB_Zendesk_Tickets.csv";
const USED_PARTS_MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";

const OUTPUT_VIEW_FILE = "data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv";
const SUMMARY_FILE = "data/reports/fieldbeat_report_dolibarr_summary.json";

function cleanId(value) {
  return String(value ?? "").trim();
}

function isTrue(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function uniqueNonEmpty(values) {
  const seen = new Set();

  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (clean) seen.add(clean);
  }

  return Array.from(seen);
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

// client_key tiene el formato "FIELD_BEAT_CLIENT|<rut>|<nombre>" (ver
// fieldbeat-normalizer.js). Se parsea acá en vez de leer DIM_Clients.csv
// porque no estaba en la lista de archivos a leer para este mart.
function parseClientKey(clientKey) {
  const parts = String(clientKey ?? "").split("|");
  return {
    rut: parts.length >= 2 ? parts[1] : "",
    name: parts.length >= 3 ? parts[2] : ""
  };
}

function groupBy(rows, keyName) {
  const map = new Map();

  for (const row of rows) {
    const key = cleanId(row[keyName]);
    if (!key) continue;

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  return map;
}

function aggregatePartsForTask(parts) {
  const counts = {
    total: parts.length,
    matched: 0,
    placeholder: 0,
    unmatched: 0,
    ambiguous: 0,
    reviewRequired: 0
  };

  for (const part of parts) {
    if (part.match_status === "MATCHED") counts.matched += 1;
    if (part.match_status === "PLACEHOLDER_VALUE") counts.placeholder += 1;
    if (part.match_status === "NO_MATCH") counts.unmatched += 1;
    if (part.match_status === "AMBIGUOUS_MATCH") counts.ambiguous += 1;
    if (isTrue(part.needs_manual_review)) counts.reviewRequired += 1;
  }

  return counts;
}

// Mismo tipo de cascada que en el mart ticket-céntrico, pero a nivel de
// UN reporte (no de N relaciones): no existe "NO_FIELDBEAT_REPORT" acá
// porque cada fila YA ES un reporte FieldBeat; en su lugar, NO_USED_PARTS.
function computeReportQualityStatus(counts) {
  if (counts.total === 0) return "NO_USED_PARTS";
  if (counts.ambiguous > 0) return "HAS_AMBIGUOUS_PARTS";
  if (counts.unmatched > 0) return "HAS_UNMATCHED_PARTS";
  if (counts.placeholder > 0) return "HAS_PLACEHOLDERS";
  if (counts.reviewRequired > 0) return "REVIEW_REQUIRED";
  return "OK";
}

async function buildFieldBeatReportDolibarrView() {
  console.log("=== Construyendo vista FieldBeat Report <-> Dolibarr (report-centric) ===");

  const tasks = await readCsv(TASKS_FILE);
  const equipments = await readCsv(EQUIPMENTS_FILE);
  const bridgeRows = await readCsv(BRIDGE_FILE);
  const zendeskTickets = await readCsv(ZENDESK_TICKETS_FILE);
  const usedPartsMatchRows = await readCsv(USED_PARTS_MATCH_FILE);

  console.log(`Tasks FieldBeat: ${tasks.length}`);
  console.log(`Relaciones puente: ${bridgeRows.length}`);
  console.log(`Tickets Zendesk accesibles: ${zendeskTickets.length}`);
  console.log(`Used parts (global): ${usedPartsMatchRows.length}`);

  const zendeskTicketIds = new Set(zendeskTickets.map(t => cleanId(t.zendesk_ticket_id)));
  const equipmentsByTaskId = groupBy(equipments, "fieldbeat_task_id");
  const bridgeByTaskId = groupBy(bridgeRows, "fieldbeat_task_id");
  const usedPartsByTaskId = groupBy(usedPartsMatchRows, "fieldbeat_task_id");

  // No se excluye ningún task por no tener ticket Zendesk: 1 fila por cada
  // fieldbeat_task_id de DB_FieldBeat_Tasks.csv, sin filtrar.
  const outputRows = tasks.map(task => {
    const taskId = cleanId(task.fieldbeat_task_id);
    const { rut, name } = parseClientKey(task.client_key);

    const taskEquipments = equipmentsByTaskId.get(taskId) || [];
    const taskBridgeRows = bridgeByTaskId.get(taskId) || [];
    const taskParts = usedPartsByTaskId.get(taskId) || [];

    let linkedTicketId = "";
    let zendeskJoinStatus = "NO_TICKET_REPORTED";

    if (taskBridgeRows.length > 0) {
      linkedTicketId = cleanId(taskBridgeRows[0].zendesk_ticket_id);
      zendeskJoinStatus = zendeskTicketIds.has(linkedTicketId)
        ? "LINKED_TO_ACCESSIBLE_ZENDESK"
        : "LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK";
    }

    const counts = aggregatePartsForTask(taskParts);

    return {
      fieldbeat_task_id: taskId,
      fieldbeat_task_date: task.start_time || task.created_at || "",
      client_key: task.client_key || "",
      client_rut: rut,
      client_name: name,
      task_type: task.task_type || "",
      task_state: task.state || "",
      technician_names: task.assigned_to || "",
      equipment_internal_ids: uniqueNonEmpty(taskEquipments.map(e => e.equipment_internal_id)).join("|"),
      linked_zendesk_ticket_id: linkedTicketId,
      zendesk_join_status: zendeskJoinStatus,
      used_parts_count: counts.total,
      matched_used_parts_count: counts.matched,
      placeholder_used_parts_count: counts.placeholder,
      unmatched_used_parts_count: counts.unmatched,
      ambiguous_used_parts_count: counts.ambiguous,
      review_required_used_parts_count: counts.reviewRequired,
      dolibarr_refs: uniqueNonEmpty(taskParts.map(p => p.dolibarr_ref)).join("|"),
      dolibarr_product_ids: uniqueNonEmpty(taskParts.map(p => p.dolibarr_product_id)).join("|"),
      used_part_numbers: uniqueNonEmpty(taskParts.map(p => p.raw_part_identifier)).join("|"),
      used_part_names: uniqueNonEmpty(taskParts.map(p => p.part_name)).join("|"),
      part_match_statuses: uniqueNonEmpty(taskParts.map(p => p.match_status)).join("|"),
      part_match_methods: uniqueNonEmpty(taskParts.map(p => p.match_method)).join("|"),
      report_quality_status: computeReportQualityStatus(counts)
    };
  });

  await writeCsv(OUTPUT_VIEW_FILE, outputRows);

  const joinStatusBreakdown = {};
  const qualityStatusBreakdown = {};

  for (const row of outputRows) {
    joinStatusBreakdown[row.zendesk_join_status] = (joinStatusBreakdown[row.zendesk_join_status] || 0) + 1;
    qualityStatusBreakdown[row.report_quality_status] = (qualityStatusBreakdown[row.report_quality_status] || 0) + 1;
  }

  const sumField = field => outputRows.reduce((sum, r) => sum + Number(r[field] || 0), 0);

  const totalUsedParts = sumField("used_parts_count");
  const matchedUsedParts = sumField("matched_used_parts_count");
  const placeholderUsedParts = sumField("placeholder_used_parts_count");
  const unmatchedUsedParts = sumField("unmatched_used_parts_count");
  const ambiguousUsedParts = sumField("ambiguous_used_parts_count");
  const reviewRequiredUsedParts = sumField("review_required_used_parts_count");

  // Chequeo cruzado: como este mart no excluye ningún task, la suma de
  // used_parts_count debe calzar EXACTO con el total global de
  // Used_Parts_Dolibarr_Match.csv (a diferencia del mart ticket-céntrico,
  // que solo cubre una fracción).
  const globalTotalsMatch = totalUsedParts === usedPartsMatchRows.length;

  const summary = {
    generated_at: new Date().toISOString(),
    total_fieldbeat_reports: outputRows.length,
    zendesk_join_status_breakdown: joinStatusBreakdown,
    report_quality_status_breakdown: qualityStatusBreakdown,
    total_used_parts: totalUsedParts,
    used_parts_global_source_count: usedPartsMatchRows.length,
    used_parts_totals_match_global: globalTotalsMatch,
    matched_used_parts: matchedUsedParts,
    placeholder_used_parts: placeholderUsedParts,
    unmatched_used_parts: unmatchedUsedParts,
    ambiguous_used_parts: ambiguousUsedParts,
    match_rate: percent(matchedUsedParts, totalUsedParts),
    review_required_rate: percent(reviewRequiredUsedParts, totalUsedParts)
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log("=== Vista FieldBeat Report <-> Dolibarr finalizada ===");
}

buildFieldBeatReportDolibarrView().catch(error => {
  console.error("ERROR CONSTRUYENDO VISTA FIELDBEAT REPORT <-> DOLIBARR:");
  console.error(error);
  process.exit(1);
});
