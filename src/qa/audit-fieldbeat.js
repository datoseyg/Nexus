import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const BASE_DIR = "data/processed/fieldbeat";

const FILES = {
  tasks: "DB_FieldBeat_Tasks.csv",
  equipments: "DB_FieldBeat_Task_Equipments.csv",
  reportFields: "DB_FieldBeat_Report_Fields.csv",
  usedParts: "DB_FieldBeat_Used_Parts.csv",
  clients: "DIM_Clients.csv",
  dimEquipments: "DIM_Equipments.csv",
  bridge: "BR_Ticket_FieldBeat_Task.csv"
};

async function readCsv(fileName) {
  const filePath = path.join(BASE_DIR, fileName);

  try {
    const raw = await fs.readFile(filePath, "utf8");

    if (!raw.trim()) return [];

    return parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    console.warn(`No se pudo leer ${fileName}: ${error.message}`);
    return [];
  }
}

function countDuplicates(rows, keyName) {
  const seen = new Set();
  const duplicates = [];

  for (const row of rows) {
    const key = String(row[keyName] || "").trim();

    if (!key) continue;

    if (seen.has(key)) {
      duplicates.push(key);
    }

    seen.add(key);
  }

  return duplicates;
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function auditFieldBeat() {
  console.log("=== AUDITORÍA FIELDBEAT NORMALIZADO ===");

  const tasks = await readCsv(FILES.tasks);
  const equipments = await readCsv(FILES.equipments);
  const reportFields = await readCsv(FILES.reportFields);
  const usedParts = await readCsv(FILES.usedParts);
  const clients = await readCsv(FILES.clients);
  const dimEquipments = await readCsv(FILES.dimEquipments);
  const bridge = await readCsv(FILES.bridge);

  const tasksWithTicket = tasks.filter(t =>
    String(t.linked_zendesk_ticket_id || "").trim()
  );

  const tasksWithoutTicket = tasks.filter(t =>
    !String(t.linked_zendesk_ticket_id || "").trim()
  );

  const bridgeTaskIds = new Set(
    bridge.map(b => String(b.fieldbeat_task_id || "").trim()).filter(Boolean)
  );

  const tasksWithTicketButNoBridge = tasksWithTicket.filter(t => {
    const taskId = String(t.fieldbeat_task_id || "").trim();
    return !bridgeTaskIds.has(taskId);
  });

  const ticketFields = reportFields.filter(f => {
    const name = normalizeText(f.field_name);
    return name.includes("ticket");
  });

  const usedPartsWithPartNumber = usedParts.filter(p =>
    String(p.part_number || "").trim()
  );

  const usedPartsWithoutPartNumber = usedParts.filter(p =>
    !String(p.part_number || "").trim()
  );

  const duplicateTasks = countDuplicates(tasks, "fieldbeat_task_id");
  const duplicateBridge = countDuplicates(bridge, "bridge_id");
  const duplicateReportFields = countDuplicates(reportFields, "report_field_id");

  const report = {
    generated_at: new Date().toISOString(),
    row_counts: {
      DB_FieldBeat_Tasks: tasks.length,
      DB_FieldBeat_Task_Equipments: equipments.length,
      DB_FieldBeat_Report_Fields: reportFields.length,
      DB_FieldBeat_Used_Parts: usedParts.length,
      DIM_Clients: clients.length,
      DIM_Equipments: dimEquipments.length,
      BR_Ticket_FieldBeat_Task: bridge.length
    },
    coverage: {
      tasks_with_zendesk_ticket: tasksWithTicket.length,
      tasks_without_zendesk_ticket: tasksWithoutTicket.length,
      ticket_coverage: percent(tasksWithTicket.length, tasks.length),
      bridge_rows: bridge.length,
      tasks_with_ticket_but_no_bridge: tasksWithTicketButNoBridge.length
    },
    report_fields: {
      total_report_fields: reportFields.length,
      ticket_like_fields: ticketFields.length
    },
    used_parts: {
      total_used_parts: usedParts.length,
      used_parts_with_part_number: usedPartsWithPartNumber.length,
      used_parts_without_part_number: usedPartsWithoutPartNumber.length,
      part_number_coverage: percent(usedPartsWithPartNumber.length, usedParts.length)
    },
    duplicates: {
      duplicate_tasks: duplicateTasks.length,
      duplicate_bridge_rows: duplicateBridge.length,
      duplicate_report_fields: duplicateReportFields.length
    },
    samples: {
      first_10_tasks_with_ticket: tasksWithTicket.slice(0, 10).map(t => ({
        fieldbeat_task_id: t.fieldbeat_task_id,
        linked_zendesk_ticket_id: t.linked_zendesk_ticket_id,
        state: t.state,
        client_key: t.client_key
      })),
      first_10_bridge_rows: bridge.slice(0, 10),
      first_10_ticket_fields: ticketFields.slice(0, 10).map(f => ({
        fieldbeat_task_id: f.fieldbeat_task_id,
        group_name: f.group_name,
        field_name: f.field_name,
        field_value: f.field_value
      }))
    }
  };

  await fs.mkdir("data/reports", { recursive: true });

  await fs.writeFile(
    "data/reports/fieldbeat_audit_report.json",
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(report, null, 2));
  console.log("Reporte guardado en data/reports/fieldbeat_audit_report.json");
}

auditFieldBeat().catch(error => {
  console.error("ERROR AUDITANDO FIELDBEAT:");
  console.error(error);
  process.exit(1);
});