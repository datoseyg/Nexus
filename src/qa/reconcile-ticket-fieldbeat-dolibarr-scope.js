import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";

const TICKET_MART_FILE = "data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv";
const USED_PARTS_MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";
const FIELDBEAT_TASKS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv";
const BRIDGE_FILE = "data/processed/fieldbeat/BR_Ticket_FieldBeat_Task.csv";
const ZENDESK_TICKETS_FILE = "data/processed/zendesk/DB_Zendesk_Tickets.csv";

const SUMMARY_FILE = "data/reports/scope_reconciliation_summary.json";
const USED_PARTS_OUTSIDE_SCOPE_FILE = "data/reports/used_parts_outside_zendesk_ticket_scope.csv";
const TASKS_WITHOUT_TICKET_FILE = "data/reports/fieldbeat_tasks_without_zendesk_ticket.csv";
const TASKS_LINKED_TO_MISSING_TICKET_FILE = "data/reports/fieldbeat_tasks_linked_to_missing_zendesk_ticket.csv";

function cleanId(value) {
  return String(value ?? "").trim();
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

async function reconcileScope() {
  console.log("=== Reconciliación de alcance Ticket <-> FieldBeat <-> Dolibarr ===");

  const ticketMartRows = await readCsv(TICKET_MART_FILE);
  const usedPartsMatchRows = await readCsv(USED_PARTS_MATCH_FILE);
  const fieldbeatTasks = await readCsv(FIELDBEAT_TASKS_FILE);
  const bridgeRows = await readCsv(BRIDGE_FILE);
  const zendeskTickets = await readCsv(ZENDESK_TICKETS_FILE);

  console.log(`Tickets en el mart final: ${ticketMartRows.length}`);
  console.log(`Used parts (global): ${usedPartsMatchRows.length}`);
  console.log(`Tasks FieldBeat: ${fieldbeatTasks.length}`);
  console.log(`Relaciones puente: ${bridgeRows.length}`);
  console.log(`Tickets Zendesk: ${zendeskTickets.length}`);

  const zendeskTicketIds = new Set(zendeskTickets.map(t => cleanId(t.zendesk_ticket_id)));
  const fieldbeatTaskById = new Map(fieldbeatTasks.map(t => [cleanId(t.fieldbeat_task_id), t]));

  const bridgeByTaskId = new Map();
  for (const row of bridgeRows) {
    const taskId = cleanId(row.fieldbeat_task_id);
    if (!taskId) continue;
    if (!bridgeByTaskId.has(taskId)) bridgeByTaskId.set(taskId, []);
    bridgeByTaskId.get(taskId).push(row);
  }

  // Un task esta "en alcance" del mart final si al menos una de sus filas
  // puente apunta a un zendesk_ticket_id que realmente existe en
  // DB_Zendesk_Tickets.csv. Si tiene filas puente pero NINGUNA apunta a un
  // ticket existente, el task quedo fuera del mart (ticket "fantasma").
  const inScopeTaskIds = new Set();
  const linkedToMissingTaskIds = new Set();

  for (const [taskId, rows] of bridgeByTaskId.entries()) {
    const hasExistingTicket = rows.some(r => zendeskTicketIds.has(cleanId(r.zendesk_ticket_id)));
    if (hasExistingTicket) {
      inScopeTaskIds.add(taskId);
    } else {
      linkedToMissingTaskIds.add(taskId);
    }
  }

  const tasksWithoutZendeskTicket = fieldbeatTasks.filter(t => !bridgeByTaskId.has(cleanId(t.fieldbeat_task_id)));

  const tasksLinkedToMissingTicketRows = bridgeRows
    .filter(row => !zendeskTicketIds.has(cleanId(row.zendesk_ticket_id)))
    .map(row => {
      const task = fieldbeatTaskById.get(cleanId(row.fieldbeat_task_id));

      return {
        bridge_id: row.bridge_id || "",
        missing_zendesk_ticket_id: row.zendesk_ticket_id || "",
        fieldbeat_task_id: row.fieldbeat_task_id || "",
        task_type: task?.task_type || "",
        state: task?.state || "",
        client_key: task?.client_key || "",
        created_at: task?.created_at || "",
        link_method: row.link_method || ""
      };
    });

  const usedPartsInTicketMart = usedPartsMatchRows.filter(row => inScopeTaskIds.has(cleanId(row.fieldbeat_task_id)));
  const usedPartsOutsideTicketMart = usedPartsMatchRows.filter(row => !inScopeTaskIds.has(cleanId(row.fieldbeat_task_id)));

  await writeCsv(USED_PARTS_OUTSIDE_SCOPE_FILE, usedPartsOutsideTicketMart);
  await writeCsv(TASKS_WITHOUT_TICKET_FILE, tasksWithoutZendeskTicket.map(t => ({
    fieldbeat_task_id: t.fieldbeat_task_id || "",
    task_type: t.task_type || "",
    state: t.state || "",
    priority: t.priority || "",
    client_key: t.client_key || "",
    created_at: t.created_at || "",
    updated_at: t.updated_at || ""
  })));
  await writeCsv(TASKS_LINKED_TO_MISSING_TICKET_FILE, tasksLinkedToMissingTicketRows);

  const fieldbeatTasksWithZendeskTicket = bridgeByTaskId.size;
  const fieldbeatTasksWithoutZendeskTicket = fieldbeatTasks.length - fieldbeatTasksWithZendeskTicket;

  // Chequeo cruzado: el total de used_parts_count sumado desde el mart final
  // debe calzar exacto con used_parts_in_ticket_mart calculado acá de forma
  // independiente (via bridge). Si no calzan, hay un bug real en algún mart.
  const ticketMartUsedPartsTotal = ticketMartRows.reduce(
    (sum, row) => sum + Number(row.used_parts_count || 0),
    0
  );
  const ticketMartTotalsMatch = ticketMartUsedPartsTotal === usedPartsInTicketMart.length;

  const summary = {
    generated_at: new Date().toISOString(),
    total_zendesk_tickets: zendeskTickets.length,
    total_fieldbeat_tasks: fieldbeatTasks.length,
    total_fieldbeat_used_parts_global: usedPartsMatchRows.length,
    used_parts_in_ticket_mart: usedPartsInTicketMart.length,
    used_parts_outside_ticket_mart: usedPartsOutsideTicketMart.length,
    fieldbeat_tasks_with_zendesk_ticket: fieldbeatTasksWithZendeskTicket,
    fieldbeat_tasks_without_zendesk_ticket: fieldbeatTasksWithoutZendeskTicket,
    fieldbeat_tasks_linked_to_existing_zendesk_ticket: inScopeTaskIds.size,
    fieldbeat_tasks_linked_to_missing_zendesk_ticket: linkedToMissingTaskIds.size,
    ticket_mart_used_parts_total: ticketMartUsedPartsTotal,
    ticket_mart_totals_match: ticketMartTotalsMatch,
    used_parts_in_ticket_mart_rate: percent(usedPartsInTicketMart.length, usedPartsMatchRows.length),
    fieldbeat_tasks_with_zendesk_ticket_rate: percent(fieldbeatTasksWithZendeskTicket, fieldbeatTasks.length),
    explanation_of_scope:
      "El mart Ticket_FieldBeat_Dolibarr_Operational_View.csv es ticket-centrico: " +
      "1 fila por cada uno de los " + zendeskTickets.length + " tickets Zendesk minados. " +
      "Solo se incluyen repuestos de tasks FieldBeat cuya relacion puente (BR_Ticket_FieldBeat_Task) " +
      "apunta a un zendesk_ticket_id que realmente existe en DB_Zendesk_Tickets.csv. " +
      "De los " + fieldbeatTasks.length + " tasks FieldBeat totales, " + fieldbeatTasksWithoutZendeskTicket +
      " nunca registraron un numero de ticket en su reporte (sin fila puente), y " + linkedToMissingTaskIds.size +
      " registraron un numero de ticket que no corresponde a ningun ticket Zendesk minado " +
      "(ticket fantasma / typo / ticket fuera del rango minado). Por eso el mart final solo contiene " +
      usedPartsInTicketMart.length + " de los " + usedPartsMatchRows.length + " repuestos globales: el resto " +
      "pertenece a tasks fuera de alcance de los tickets Zendesk actualmente minados, no a un bug de matching."
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log("=== Reconciliación de alcance finalizada ===");
}

reconcileScope().catch(error => {
  console.error("ERROR RECONCILIANDO ALCANCE:");
  console.error(error);
  process.exit(1);
});
