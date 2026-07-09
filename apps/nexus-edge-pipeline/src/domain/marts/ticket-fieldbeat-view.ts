// Constructor MARTS #2 - Ticket_FieldBeat_Operational_View: une Tickets de
// Zendesk con Tasks/Equipments/Used_Parts de FieldBeat a traves de la
// tabla puente BR_Ticket_FieldBeat_Task. Equivalente puro de
// build-ticket-fieldbeat-view.js (pipeline local) - solo la vista
// operacional principal, sin Ticket_FieldBeat_Report_Detail ni el reporte
// de links-sin-ticket (esos son reportes de auditoria/reconciliacion, no
// una tabla MARTS, y quedan fuera del alcance de este modulo a proposito).
//
// PURO: no importa nada de R2/Queues/Cloudflare, no hace I/O.

import { cleanId, groupBy, uniqueNonEmpty } from "./lib";
import type { UsedPartSourceRow } from "./used-parts-match";

// Formas de fila de las tablas PROCESSED (ver
// src/domain/normalizers/zendesk.ts y fieldbeat.ts) - solo las columnas
// que este cruce necesita, tal cual salen de readCsv (todas string).
// Extienden Record<string, string> para poder viajar directo desde
// readCsv() sin cast intermedio, y para calzar con groupBy() (ver
// domain/marts/lib.ts).
export interface ZendeskTicketSourceRow extends Record<string, string> {
  zendesk_ticket_id: string;
  subject: string;
  status: string;
  priority: string;
}

export interface FieldBeatTaskSourceRow extends Record<string, string> {
  fieldbeat_task_id: string;
  start_time: string;
  state: string;
  task_type: string;
  assigned_to: string;
  client_key: string;
}

export interface FieldBeatTaskEquipmentSourceRow extends Record<string, string> {
  fieldbeat_task_id: string;
  equipment_internal_id: string;
}

export interface FieldBeatTicketBridgeSourceRow extends Record<string, string> {
  zendesk_ticket_id: string;
  fieldbeat_task_id: string;
}

export type TicketFieldBeatOperationalJoinStatus =
  | "NO_FIELDBEAT_REPORT"
  | "MULTIPLE_FIELDBEAT_REPORTS"
  | "SINGLE_FIELDBEAT_REPORT";

export interface TicketFieldBeatOperationalViewRow extends Record<string, unknown> {
  zendesk_ticket_id: string;
  subject: string;
  status: string;
  priority: string;
  has_fieldbeat_report: boolean;
  fieldbeat_report_count: number;
  has_multiple_fieldbeat_reports: boolean;
  fieldbeat_task_ids: string;
  first_fieldbeat_start_time: string;
  last_fieldbeat_start_time: string;
  fieldbeat_states: string;
  fieldbeat_types: string;
  fieldbeat_assignees: string;
  client_names: string;
  equipment_internal_ids: string;
  has_used_parts: boolean;
  used_parts_count: number;
  used_part_numbers: string;
  operational_join_status: TicketFieldBeatOperationalJoinStatus;
}

export interface TicketFieldBeatViewInput {
  tickets: ZendeskTicketSourceRow[];
  tasks: FieldBeatTaskSourceRow[];
  taskEquipments: FieldBeatTaskEquipmentSourceRow[];
  usedParts: UsedPartSourceRow[];
  bridgeRows: FieldBeatTicketBridgeSourceRow[];
}

// client_key tiene la forma "FIELD_BEAT_CLIENT|<rut>|<nombre>" (ver
// makeKey() en src/domain/normalizers/fieldbeat.ts) - el nombre es
// siempre el tercer segmento.
function parseClientName(clientKey: string | undefined): string {
  const parts = String(clientKey ?? "").split("|");
  return parts.length >= 3 ? parts[2] : "";
}

function minIso(values: string[]): string {
  const valid = values
    .map(v => ({ raw: v, time: new Date(v).getTime() }))
    .filter(v => !Number.isNaN(v.time));

  if (!valid.length) return "";
  return valid.reduce((min, v) => (v.time < min.time ? v : min)).raw;
}

function maxIso(values: string[]): string {
  const valid = values
    .map(v => ({ raw: v, time: new Date(v).getTime() }))
    .filter(v => !Number.isNaN(v.time));

  if (!valid.length) return "";
  return valid.reduce((max, v) => (v.time > max.time ? v : max)).raw;
}

// JOIN Ticket <-> FieldBeat totalmente en memoria con Maps: tasksByTaskId,
// usedPartsByTaskId, equipmentsByTaskId y bridgeByTicketId se construyen
// UNA vez (O(tasks + usedParts + equipments + bridge)), y despues cada
// ticket hace lookups O(1) contra esos Maps en lugar de escanear los
// arrays completos por ticket - la alternativa ingenua
// (`tasks.filter(t => ticketIdDe(t) === ticket.id)` dentro de un `.map()`
// externo) seria O(tickets * tasks), inaceptable con el limite de
// 128MB/CPU de un Worker.
export function buildTicketFieldBeatOperationalView(input: TicketFieldBeatViewInput): TicketFieldBeatOperationalViewRow[] {
  const { tickets, tasks, taskEquipments, usedParts, bridgeRows } = input;

  const tasksByTaskId = new Map<string, FieldBeatTaskSourceRow>();
  for (const task of tasks) {
    const id = cleanId(task.fieldbeat_task_id);
    if (id) tasksByTaskId.set(id, task);
  }

  const usedPartsByTaskId = groupBy(usedParts, "fieldbeat_task_id");
  const equipmentsByTaskId = groupBy(taskEquipments, "fieldbeat_task_id");
  const bridgeByTicketId = groupBy(bridgeRows, "zendesk_ticket_id");

  return tickets.map(ticket => {
    const ticketId = cleanId(ticket.zendesk_ticket_id);
    const links = bridgeByTicketId.get(ticketId) || [];

    const taskIds = uniqueNonEmpty(links.map(l => l.fieldbeat_task_id));
    const linkedTasks = taskIds
      .map(id => tasksByTaskId.get(id))
      .filter((task): task is FieldBeatTaskSourceRow => Boolean(task));

    const taskUsedParts = taskIds.flatMap(id => usedPartsByTaskId.get(id) || []);
    const taskEquipmentsForTicket = taskIds.flatMap(id => equipmentsByTaskId.get(id) || []);

    const hasFieldbeatReport = taskIds.length > 0;
    const hasMultipleReports = taskIds.length > 1;

    return {
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
      equipment_internal_ids: uniqueNonEmpty(taskEquipmentsForTicket.map(e => e.equipment_internal_id)).join("|"),
      has_used_parts: taskUsedParts.length > 0,
      used_parts_count: taskUsedParts.length,
      used_part_numbers: uniqueNonEmpty(taskUsedParts.map(p => p.part_number)).join("|"),
      operational_join_status: !hasFieldbeatReport
        ? "NO_FIELDBEAT_REPORT"
        : hasMultipleReports
          ? "MULTIPLE_FIELDBEAT_REPORTS"
          : "SINGLE_FIELDBEAT_REPORT"
    };
  });
}
