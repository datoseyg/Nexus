import fs from "node:fs/promises";
import path from "node:path";

const INPUT_FILE = "data/raw/fieldbeat/all_tasks_latest.json";
const OUTPUT_DIR = "data/processed/fieldbeat";

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeCsv(filePath, rows) {
  await ensureDir(path.dirname(filePath));

  if (!rows.length) {
    await fs.writeFile(filePath, "", "utf8");
    console.log(`CSV vacío: ${filePath}`);
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))
  ].join("\n");

  await fs.writeFile(filePath, csv, "utf8");
  console.log(`CSV generado: ${filePath} (${rows.length} filas)`);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function makeKey(...parts) {
  return parts
    .map(x => String(x ?? "").trim())
    .join("|");
}

function toDateIso(value) {
  if (!value) return "";

  const n = Number(value);

  if (!Number.isNaN(n) && String(value).length >= 10) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return "";
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isNaN(n) ? "" : n;
}

function getGroups(task) {
  return task?.report?.groups || [];
}

function getFieldValueFromGroup(group, targetName) {
  const target = normalizeText(targetName);

  const field = (group.fields || []).find(f => {
    return normalizeText(f.name) === target;
  });

  return field?.value || "";
}

function findFieldValue(task, possibleNames) {
  const normalizedTargets = possibleNames.map(normalizeText);

  for (const group of getGroups(task)) {
    for (const field of group.fields || []) {
      const fieldName = normalizeText(field.name);

      if (normalizedTargets.includes(fieldName)) {
        return field.value || "";
      }
    }
  }

  return "";
}

function extractZendeskTicketId(task) {
  const raw = findFieldValue(task, [
    "NUMERO DE TICKET",
    "NÚMERO DE TICKET",
    "Numero de Ticket",
    "N° Ticket",
    "Nº Ticket",
    "Ticket"
  ]);

  const match = String(raw || "").match(/\d+/);
  return match ? match[0] : "";
}

function extractTrabajoRealizado(task) {
  return findFieldValue(task, [
    "TRABAJO REALIZADO",
    "DESCRIPCIÓN DE LA INTERVENCIÓN",
    "DESCRIPCION DE LA INTERVENCION"
  ]);
}

function inferEquipmentType(internalId) {
  const value = normalizeText(internalId);

  if (value.includes("linac")) return "LINAC";
  if (value.includes("braqui")) return "BRAQUITERAPIA";
  if (value.includes("ct")) return "CT";
  if (value.includes("rx")) return "RX";

  return "";
}

function extractTasks(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;

  return [];
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

// Detecta listas explícitamente numeradas ("1.- x", "2- y", ...) con índices
// estrictamente crecientes. Si cualquier línea no calza el patrón, o los
// índices no son crecientes, se considera que NO es una lista (se devuelve
// null) y el valor se deja intacto en una sola fila. Esto evita explotar
// valores como "107043-11" (guion dentro del propio código, no un marcador
// de lista) o "motores: 123\ntornillo: 456" (líneas con etiqueta, no número).
const NUMBERED_LINE_PATTERN = /^(\d{1,2})[.\-)]+\s*(.*)$/;

function tryParseNumberedList(rawValue) {
  const lines = splitLines(rawValue);
  if (lines.length < 2) return null;

  const parsed = [];
  let previousIndex = 0;

  for (const line of lines) {
    const match = line.match(NUMBERED_LINE_PATTERN);
    if (!match) return null;

    const index = Number(match[1]);
    const text = match[2].trim();

    if (index <= previousIndex || !text) return null;

    previousIndex = index;
    parsed.push(text);
  }

  return parsed;
}

// Explota part_number en items atómicos cuando es una lista numerada.
// part_name y quantity se alinean por posición SOLO si también son listas
// numeradas del mismo largo; si no, se mantienen sin partir y la fila queda
// marcada needsManualReview para revisión humana (ver reglas del Sprint 3).
function explodeUsedPartItems({ rawPartNumber, rawPartName, rawQuantity }) {
  const partNumberList = tryParseNumberedList(rawPartNumber);

  if (!partNumberList) {
    return [{
      partNumber: rawPartNumber,
      partName: rawPartName,
      quantity: safeNumber(rawQuantity),
      needsManualReview: false
    }];
  }

  const partNameList = tryParseNumberedList(rawPartName);
  const quantityList = tryParseNumberedList(rawQuantity);

  const partNameAligned = Boolean(partNameList) && partNameList.length === partNumberList.length;
  const quantityAligned = Boolean(quantityList) && quantityList.length === partNumberList.length;

  const singleQuantity = safeNumber(rawQuantity);
  const applySingleQuantityToAll = !quantityAligned && singleQuantity === 1;

  return partNumberList.map((partNumber, position) => {
    const partName = partNameAligned ? partNameList[position] : rawPartName;

    const quantity = quantityAligned
      ? safeNumber(quantityList[position])
      : (applySingleQuantityToAll ? 1 : "");

    const needsManualReview =
      (!partNameAligned && Boolean(rawPartName)) ||
      (!quantityAligned && !applySingleQuantityToAll && Boolean(rawQuantity));

    return { partNumber, partName, quantity, needsManualReview };
  });
}

function buildFieldBeatTables(tasks) {
  const taskRows = [];
  const equipmentRows = [];
  const reportFieldRows = [];
  const usedPartRows = [];
  const clientRows = [];
  const equipmentDimRows = [];
  const bridgeRows = [];

  const extractedAt = new Date().toISOString();

  for (const task of tasks) {
    const taskId = String(task.task_id ?? task.id ?? "").trim();
    if (!taskId) continue;

    const linkedTicketId = extractZendeskTicketId(task);

    const clientName = task.client?.name || "";
    const clientRut = task.client?.rut || "";
    const clientKey = makeKey("FIELD_BEAT_CLIENT", clientRut, clientName);

    taskRows.push({
      fieldbeat_task_id: taskId,
      linked_zendesk_ticket_id: linkedTicketId,
      task_type: task.type || "",
      priority: safeNumber(task.priority),
      state: task.state || "",
      description: task.description || extractTrabajoRealizado(task),
      client_key: clientKey,
      assigned_to: task.assigned_to || "",
      created_by: task.created_by || "",
      created_at: toDateIso(task.created_at),
      updated_at: toDateIso(task.updated_at),
      start_time: toDateIso(task.start_time),
      duration_minutes: safeNumber(task.duration),
      last_transition_at: toDateIso(task.last_transition_at),
      finished_data_synced_at: toDateIso(task.finished_data_synced_at),
      created_in: task.created_in || "",
      extracted_at: extractedAt
    });

    if (task.client) {
      clientRows.push({
        client_key: clientKey,
        client_name: clientName,
        rut: clientRut,
        fieldbeat_client_name: clientName,
        address_raw: task.client?.address?.raw_address || "",
        city: task.client?.address?.city || "",
        commune: task.client?.address?.commune || "",
        country: task.client?.address?.country || "",
        latitude: task.client?.address?.latitude || "",
        longitude: task.client?.address?.longitude || "",
        updated_at: extractedAt
      });
    }

    for (const eq of task.equipments || []) {
      const equipmentUuid = eq.id || "";
      const internalId = eq.internal_id || "";
      const equipmentKey = makeKey("FIELDBEAT_EQUIPMENT", equipmentUuid, internalId);

      equipmentRows.push({
        task_equipment_id: makeKey(taskId, equipmentUuid, internalId),
        fieldbeat_task_id: taskId,
        equipment_uuid: equipmentUuid,
        equipment_internal_id: internalId,
        extracted_at: extractedAt
      });

      equipmentDimRows.push({
        equipment_key: equipmentKey,
        equipment_uuid: equipmentUuid,
        internal_id: internalId,
        client_key: clientKey,
        equipment_type: inferEquipmentType(internalId),
        source_system: "FIELDBEAT",
        updated_at: extractedAt
      });
    }

    for (const group of getGroups(task)) {
      for (const field of group.fields || []) {
        reportFieldRows.push({
          report_field_id: makeKey(taskId, group.name, group.index, field.name, field.index),
          fieldbeat_task_id: taskId,
          group_name: group.name || "",
          group_index: group.index ?? "",
          group_copy_of: group.copy_of || "",
          is_group_copy: Boolean(group.is_copy),
          field_name: field.name || "",
          field_index: field.index ?? "",
          field_type: field.type || "",
          field_value: field.value || "",
          mandatory: Boolean(field.mandatory),
          possible_values: Array.isArray(field.possible_values)
            ? field.possible_values.join("|")
            : field.possible_values || "",
          etag: field.etag || "",
          extracted_at: extractedAt
        });
      }
    }

    const repuestoGroups = getGroups(task).filter(group => {
      return normalizeText(group.name).startsWith("repuestos");
    });

    for (const group of repuestoGroups) {
      const rawPartNumber =
        getFieldValueFromGroup(group, "NÚMERO DE PARTE (Leer código de barra del repuesto)") ||
        getFieldValueFromGroup(group, "NUMERO DE PARTE") ||
        getFieldValueFromGroup(group, "NÚMERO DE PARTE");

      const rawPartName =
        getFieldValueFromGroup(group, "NOMBRE DEL REPUESTO O INSUMO UTILIZADO") ||
        getFieldValueFromGroup(group, "NOMBRE DEL REPUESTO");

      const rawQuantity =
        getFieldValueFromGroup(group, "CANTIDAD DE REPUESTOS UTILIZADOS") ||
        getFieldValueFromGroup(group, "CANTIDAD");

      const originLocation =
        getFieldValueFromGroup(group, "UBICACIÓN DE ORIGEN DE REPUESTO") ||
        getFieldValueFromGroup(group, "UBICACION DE ORIGEN DE REPUESTO");

      const photoRef =
        getFieldValueFromGroup(group, "FOTO DEL REPUESTO UTILIZADO");

      if (!rawPartNumber && !rawPartName) continue;

      const items = explodeUsedPartItems({ rawPartNumber, rawPartName, rawQuantity });

      items.forEach((item, itemIndex) => {
        usedPartRows.push({
          used_part_id: makeKey(taskId, group.index ?? 0, itemIndex, item.partNumber),
          fieldbeat_task_id: taskId,
          zendesk_ticket_id: linkedTicketId,
          part_number: item.partNumber,
          part_name: item.partName,
          quantity: item.quantity,
          raw_original_part_number: rawPartNumber,
          raw_original_part_name: rawPartName,
          origin_location: originLocation,
          photo_ref: photoRef,
          dolibarr_product_id: "",
          dolibarr_ref: item.partNumber,
          unit_cost: "",
          estimated_total_cost: "",
          needs_manual_review: item.needsManualReview,
          extracted_at: extractedAt
        });
      });
    }

    if (linkedTicketId) {
      bridgeRows.push({
        bridge_id: makeKey(linkedTicketId, taskId),
        zendesk_ticket_id: linkedTicketId,
        fieldbeat_task_id: taskId,
        link_method: "fieldbeat_report_ticket_number",
        confidence: 1,
        created_at: extractedAt
      });
    }
  }

  return {
    taskRows,
    equipmentRows,
    reportFieldRows,
    usedPartRows,
    clientRows,
    equipmentDimRows,
    bridgeRows
  };
}

function dedupeBy(rows, keyName) {
  const map = new Map();

  for (const row of rows) {
    const key = row[keyName];
    if (!key) continue;
    map.set(key, row);
  }

  return Array.from(map.values());
}

async function normalizeFieldBeat() {
  console.log("=== Normalizando FieldBeat RAW ===");

  const raw = await fs.readFile(INPUT_FILE, "utf8");
  const payload = JSON.parse(raw);
  const tasks = extractTasks(payload);

  console.log(`Tasks leídas desde RAW: ${tasks.length}`);

  const tables = buildFieldBeatTables(tasks);

  await writeCsv(`${OUTPUT_DIR}/DB_FieldBeat_Tasks.csv`, dedupeBy(tables.taskRows, "fieldbeat_task_id"));
  await writeCsv(`${OUTPUT_DIR}/DB_FieldBeat_Task_Equipments.csv`, dedupeBy(tables.equipmentRows, "task_equipment_id"));
  await writeCsv(`${OUTPUT_DIR}/DB_FieldBeat_Report_Fields.csv`, dedupeBy(tables.reportFieldRows, "report_field_id"));
  await writeCsv(`${OUTPUT_DIR}/DB_FieldBeat_Used_Parts.csv`, dedupeBy(tables.usedPartRows, "used_part_id"));
  await writeCsv(`${OUTPUT_DIR}/DIM_Clients.csv`, dedupeBy(tables.clientRows, "client_key"));
  await writeCsv(`${OUTPUT_DIR}/DIM_Equipments.csv`, dedupeBy(tables.equipmentDimRows, "equipment_key"));
  await writeCsv(`${OUTPUT_DIR}/BR_Ticket_FieldBeat_Task.csv`, dedupeBy(tables.bridgeRows, "bridge_id"));

  console.log("=== Normalización FieldBeat finalizada ===");
}

normalizeFieldBeat().catch(error => {
  console.error("ERROR NORMALIZANDO FIELDBEAT:");
  console.error(error);
  process.exit(1);
});