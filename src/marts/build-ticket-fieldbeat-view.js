import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";

const ZENDESK_TICKETS_FILE = "data/processed/zendesk/DB_Zendesk_Tickets.csv";
const BRIDGE_FILE = "data/processed/fieldbeat/BR_Ticket_FieldBeat_Task.csv";
const TASKS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv";
const USED_PARTS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Used_Parts.csv";
const EQUIPMENTS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Task_Equipments.csv";

const OPERATIONAL_VIEW_FILE = "data/marts/Ticket_FieldBeat_Operational_View.csv";
const REPORT_DETAIL_FILE = "data/marts/Ticket_FieldBeat_Report_Detail.csv";
const SUMMARY_FILE = "data/reports/ticket_fieldbeat_operational_summary.json";
const LINKS_WITHOUT_TICKET_FILE = "data/reports/fieldbeat_links_without_zendesk_ticket.csv";

function cleanId(value) {
  return String(value ?? "").trim();
}

function uniqueNonEmpty(values) {
  const seen = new Set();

  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (clean) seen.add(clean);
  }

  return Array.from(seen);
}

function parseClientName(clientKey) {
  const parts = String(clientKey ?? "").split("|");
  return parts.length >= 3 ? parts[2] : "";
}

function minIso(values) {
  const valid = values
    .map(v => ({ raw: v, time: new Date(v).getTime() }))
    .filter(v => !Number.isNaN(v.time));

  if (!valid.length) return "";

  return valid.reduce((min, v) => (v.time < min.time ? v : min)).raw;
}

function maxIso(values) {
  const valid = values
    .map(v => ({ raw: v, time: new Date(v).getTime() }))
    .filter(v => !Number.isNaN(v.time));

  if (!valid.length) return "";

  return valid.reduce((max, v) => (v.time > max.time ? v : max)).raw;
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

async function buildTicketFieldBeatView() {
  console.log("=== Construyendo vista cruzada Ticket <-> FieldBeat ===");

  const tickets = await readCsv(ZENDESK_TICKETS_FILE);
  const bridgeRows = await readCsv(BRIDGE_FILE);
  const tasks = await readCsv(TASKS_FILE);
  const usedParts = await readCsv(USED_PARTS_FILE);
  const equipments = await readCsv(EQUIPMENTS_FILE);

  console.log(`Tickets Zendesk: ${tickets.length}`);
  console.log(`Relaciones BR_Ticket_FieldBeat_Task: ${bridgeRows.length}`);
  console.log(`Tasks FieldBeat: ${tasks.length}`);

  const ticketIds = new Set(tickets.map(t => cleanId(t.zendesk_ticket_id)));

  const tasksByTaskId = new Map(tasks.map(t => [cleanId(t.fieldbeat_task_id), t]));
  const usedPartsByTaskId = groupBy(usedParts, "fieldbeat_task_id");
  const equipmentsByTaskId = groupBy(equipments, "fieldbeat_task_id");
  const bridgeByTicketId = groupBy(bridgeRows, "zendesk_ticket_id");

  const operationalViewRows = [];
  const reportDetailRows = [];

  for (const ticket of tickets) {
    const ticketId = cleanId(ticket.zendesk_ticket_id);
    const links = bridgeByTicketId.get(ticketId) || [];

    const taskIds = uniqueNonEmpty(links.map(l => l.fieldbeat_task_id));
    const linkedTasks = taskIds.map(id => tasksByTaskId.get(id)).filter(Boolean);

    const taskUsedParts = taskIds.flatMap(id => usedPartsByTaskId.get(id) || []);
    const taskEquipments = taskIds.flatMap(id => equipmentsByTaskId.get(id) || []);

    const hasFieldbeatReport = taskIds.length > 0;
    const hasMultipleReports = taskIds.length > 1;

    operationalViewRows.push({
      zendesk_ticket_id: ticketId,
      subject: ticket.subject || "",
      status: ticket.status || "",
      priority: ticket.priority || "",
      has_fieldbeat_report: hasFieldbeatReport,
      fieldbeat_report_count: taskIds.length,
      has_multiple_fieldbeat_reports: hasMultipleReports,
      fieldbeat_task_ids: taskIds.join("|"),
      first_fieldbeat_start_time: minIso(linkedTasks.map(t => t.start_time)),
      last_fieldbeat_start_time: maxIso(linkedTasks.map(t => t.start_time)),
      fieldbeat_states: uniqueNonEmpty(linkedTasks.map(t => t.state)).join("|"),
      fieldbeat_types: uniqueNonEmpty(linkedTasks.map(t => t.task_type)).join("|"),
      fieldbeat_assignees: uniqueNonEmpty(linkedTasks.map(t => t.assigned_to)).join("|"),
      client_names: uniqueNonEmpty(linkedTasks.map(t => parseClientName(t.client_key))).join("|"),
      equipment_internal_ids: uniqueNonEmpty(taskEquipments.map(e => e.equipment_internal_id)).join("|"),
      has_used_parts: taskUsedParts.length > 0,
      used_parts_count: taskUsedParts.length,
      used_part_numbers: uniqueNonEmpty(taskUsedParts.map(p => p.part_number)).join("|"),
      operational_join_status: !hasFieldbeatReport
        ? "NO_FIELDBEAT_REPORT"
        : hasMultipleReports
          ? "MULTIPLE_FIELDBEAT_REPORTS"
          : "SINGLE_FIELDBEAT_REPORT"
    });

    for (const link of links) {
      const taskId = cleanId(link.fieldbeat_task_id);
      const task = tasksByTaskId.get(taskId);
      const taskEquipmentIds = equipmentsByTaskId.get(taskId) || [];
      const taskParts = usedPartsByTaskId.get(taskId) || [];

      reportDetailRows.push({
        bridge_id: link.bridge_id || "",
        zendesk_ticket_id: ticketId,
        fieldbeat_task_id: taskId,
        link_method: link.link_method || "",
        confidence: link.confidence || "",
        task_type: task?.task_type || "",
        state: task?.state || "",
        priority: task?.priority || "",
        description: task?.description || "",
        client_name: parseClientName(task?.client_key),
        assigned_to: task?.assigned_to || "",
        created_at: task?.created_at || "",
        updated_at: task?.updated_at || "",
        start_time: task?.start_time || "",
        duration_minutes: task?.duration_minutes || "",
        equipment_internal_ids: uniqueNonEmpty(taskEquipmentIds.map(e => e.equipment_internal_id)).join("|"),
        used_parts_count: taskParts.length,
        used_part_numbers: uniqueNonEmpty(taskParts.map(p => p.part_number)).join("|")
      });
    }
  }

  const linksWithoutTicket = bridgeRows.filter(row => !ticketIds.has(cleanId(row.zendesk_ticket_id)));

  await writeCsv(OPERATIONAL_VIEW_FILE, operationalViewRows);
  await writeCsv(REPORT_DETAIL_FILE, reportDetailRows);
  await writeCsv(LINKS_WITHOUT_TICKET_FILE, linksWithoutTicket);

  const ticketsWithReport = operationalViewRows.filter(r => r.has_fieldbeat_report);
  const ticketsWithMultipleReports = operationalViewRows.filter(r => r.has_multiple_fieldbeat_reports);
  const ticketsWithUsedParts = operationalViewRows.filter(r => r.has_used_parts);

  const statusBreakdown = {};
  for (const row of operationalViewRows) {
    statusBreakdown[row.operational_join_status] = (statusBreakdown[row.operational_join_status] || 0) + 1;
  }

  const summary = {
    generated_at: new Date().toISOString(),
    total_zendesk_tickets: tickets.length,
    tickets_with_fieldbeat_report: ticketsWithReport.length,
    tickets_without_fieldbeat_report: tickets.length - ticketsWithReport.length,
    tickets_with_multiple_fieldbeat_reports: ticketsWithMultipleReports.length,
    tickets_with_used_parts: ticketsWithUsedParts.length,
    total_bridge_relations: bridgeRows.length,
    fieldbeat_links_without_zendesk_ticket: linksWithoutTicket.length,
    operational_join_status_breakdown: statusBreakdown
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log("=== Vista cruzada Ticket <-> FieldBeat finalizada ===");
}

buildTicketFieldBeatView().catch(error => {
  console.error("ERROR CONSTRUYENDO VISTA TICKET <-> FIELDBEAT:");
  console.error(error);
  process.exit(1);
});
