import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const FIELD_BEAT_DIR = "data/processed/fieldbeat";
const REPORTS_DIR = "data/reports";

const BRIDGE_FILE = path.join(FIELD_BEAT_DIR, "BR_Ticket_FieldBeat_Task.csv");
const TASKS_FILE = path.join(FIELD_BEAT_DIR, "DB_FieldBeat_Tasks.csv");

async function readCsv(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");

    if (!raw.trim()) return [];

    return parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    console.warn(`No se pudo leer ${filePath}: ${error.message}`);
    return [];
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

async function writeCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (!rows.length) {
    await fs.writeFile(filePath, "", "utf8");
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))
  ].join("\n");

  await fs.writeFile(filePath, csv, "utf8");
}

function addRelation(map, ticketId, taskId, source) {
  const cleanTicketId = String(ticketId || "").trim();
  const cleanTaskId = String(taskId || "").trim();

  if (!cleanTicketId || !cleanTaskId) return;

  if (!map.has(cleanTicketId)) {
    map.set(cleanTicketId, {
      zendesk_ticket_id: cleanTicketId,
      task_ids: new Set(),
      sources: new Set()
    });
  }

  map.get(cleanTicketId).task_ids.add(cleanTaskId);
  map.get(cleanTicketId).sources.add(source);
}

function buildHistogram(rows) {
  const histogram = {};

  for (const row of rows) {
    const count = row.fieldbeat_report_count;
    histogram[count] = (histogram[count] || 0) + 1;
  }

  return histogram;
}

async function auditTicketFieldBeatMultiplicity() {
  console.log("=== Auditoría: tickets con más de un reporte FieldBeat ===");

  const bridgeRows = await readCsv(BRIDGE_FILE);
  const taskRows = await readCsv(TASKS_FILE);

  console.log(`Filas BR_Ticket_FieldBeat_Task: ${bridgeRows.length}`);
  console.log(`Filas DB_FieldBeat_Tasks: ${taskRows.length}`);

  const ticketMap = new Map();

  // Fuente principal: tabla puente
  for (const row of bridgeRows) {
    addRelation(
      ticketMap,
      row.zendesk_ticket_id,
      row.fieldbeat_task_id,
      "BR_Ticket_FieldBeat_Task"
    );
  }

  // Fuente respaldo: linked_zendesk_ticket_id en DB_FieldBeat_Tasks
  for (const row of taskRows) {
    addRelation(
      ticketMap,
      row.linked_zendesk_ticket_id,
      row.fieldbeat_task_id,
      "DB_FieldBeat_Tasks.linked_zendesk_ticket_id"
    );
  }

  const ticketRows = Array.from(ticketMap.values())
    .map(item => {
      const taskIds = Array.from(item.task_ids).sort((a, b) => Number(a) - Number(b));

      return {
        zendesk_ticket_id: item.zendesk_ticket_id,
        fieldbeat_report_count: taskIds.length,
        fieldbeat_task_ids: taskIds.join("|"),
        sources: Array.from(item.sources).join("|")
      };
    })
    .sort((a, b) => {
      if (b.fieldbeat_report_count !== a.fieldbeat_report_count) {
        return b.fieldbeat_report_count - a.fieldbeat_report_count;
      }

      return Number(a.zendesk_ticket_id) - Number(b.zendesk_ticket_id);
    });

  const ticketsWithMoreThanOneReport = ticketRows.filter(
    row => row.fieldbeat_report_count > 1
  );

  const ticketsWithExactlyOneReport = ticketRows.filter(
    row => row.fieldbeat_report_count === 1
  );

  const maxReportsPerTicket =
    ticketRows.length > 0
      ? Math.max(...ticketRows.map(row => row.fieldbeat_report_count))
      : 0;

  const summary = {
    generated_at: new Date().toISOString(),
    total_zendesk_tickets_with_fieldbeat_report: ticketRows.length,
    tickets_with_exactly_1_fieldbeat_report: ticketsWithExactlyOneReport.length,
    tickets_with_more_than_1_fieldbeat_report: ticketsWithMoreThanOneReport.length,
    max_fieldbeat_reports_in_single_ticket: maxReportsPerTicket,
    distribution_by_report_count: buildHistogram(ticketRows),
    top_20_tickets_with_more_reports: ticketsWithMoreThanOneReport.slice(0, 20)
  };

  await fs.mkdir(REPORTS_DIR, { recursive: true });

  await fs.writeFile(
    path.join(REPORTS_DIR, "ticket_fieldbeat_multiplicity_summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  await writeCsv(
    path.join(REPORTS_DIR, "tickets_with_more_than_1_fieldbeat_report.csv"),
    ticketsWithMoreThanOneReport
  );

  await writeCsv(
    path.join(REPORTS_DIR, "ticket_fieldbeat_report_counts.csv"),
    ticketRows
  );

  console.log(JSON.stringify(summary, null, 2));

  console.log("");
  console.log("Archivos generados:");
  console.log("data/reports/ticket_fieldbeat_multiplicity_summary.json");
  console.log("data/reports/tickets_with_more_than_1_fieldbeat_report.csv");
  console.log("data/reports/ticket_fieldbeat_report_counts.csv");
}

auditTicketFieldBeatMultiplicity().catch(error => {
  console.error("ERROR AUDITANDO MULTIPLICIDAD TICKET ↔ FIELDBEAT:");
  console.error(error);
  process.exit(1);
});