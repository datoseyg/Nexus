// Nucleo de dominio - normalizacion de FieldBeat RAW a 7 tablas tipadas.
// Transplante literal de src/normalizers/fieldbeat-normalizer.js (pipeline
// local) - mismo mapeo de campos, misma extraccion de valores desde
// "groups/fields", misma explosion de listas numeradas, mismas claves
// compuestas. Ninguna regla de negocio se reescribe "a ojo".
//
// PURO a proposito: no importa nada de R2/Queues/Cloudflare, no hace I/O.
// Ver src/use-cases/process-fieldbeat-raw.ts para quien lee el RAW y
// escribe el PROCESSED.

// ---------------------------------------------------------------------
// Entrada: forma cruda de una tarea de FieldBeat
// ---------------------------------------------------------------------

export interface FieldBeatRawClientAddress {
  raw_address?: string;
  city?: string;
  commune?: string;
  country?: string;
  latitude?: string | number;
  longitude?: string | number;
}

export interface FieldBeatRawClient {
  name?: string;
  rut?: string;
  address?: FieldBeatRawClientAddress;
}

export interface FieldBeatRawEquipment {
  id?: string;
  internal_id?: string;
}

export interface FieldBeatRawField {
  name?: string;
  index?: number | string;
  type?: string;
  // El valor de un campo de reporte es dinamico segun el tipo de campo
  // (texto libre, lista, numero...) - igual que el script heredado, no se
  // restringe el tipo, se coacciona a string recien al usarlo.
  value?: unknown;
  mandatory?: boolean;
  possible_values?: string[] | string;
  etag?: string;
}

export interface FieldBeatRawGroup {
  name?: string;
  index?: number | string;
  copy_of?: string;
  is_copy?: boolean;
  fields?: FieldBeatRawField[];
}

export interface FieldBeatRawReport {
  groups?: FieldBeatRawGroup[];
}

export interface FieldBeatRawTask {
  task_id?: string | number;
  id?: string | number;
  type?: string;
  priority?: string | number;
  state?: string;
  description?: string;
  client?: FieldBeatRawClient;
  assigned_to?: string;
  created_by?: string;
  created_at?: string | number;
  updated_at?: string | number;
  start_time?: string | number;
  duration?: string | number;
  last_transition_at?: string | number;
  finished_data_synced_at?: string | number;
  created_in?: string;
  equipments?: FieldBeatRawEquipment[];
  report?: FieldBeatRawReport;
}

// El listado de tareas (usado por el Cron ingestor, ver
// src/workers/fieldbeat-miner.ts) puede venir envuelto en distintas
// claves segun la version del endpoint - igual que extractTasks() en el
// script heredado, se soportan las 4 formas conocidas mas el array
// desnudo.
export interface FieldBeatTasksPayload {
  tasks?: FieldBeatRawTask[];
  data?: FieldBeatRawTask[];
  results?: FieldBeatRawTask[];
  items?: FieldBeatRawTask[];
  next_page?: string;
}

export type FieldBeatRawPayload = FieldBeatRawTask[] | FieldBeatTasksPayload;

// ---------------------------------------------------------------------
// Salida: filas tipadas para las 7 tablas que produce este modulo -
// mismos nombres que en el pipeline local (DB_FieldBeat_Tasks,
// DB_FieldBeat_Task_Equipments, DB_FieldBeat_Report_Fields,
// DB_FieldBeat_Used_Parts, DIM_Clients, DIM_Equipments,
// BR_Ticket_FieldBeat_Task).
// ---------------------------------------------------------------------

export interface FieldBeatTaskRow extends Record<string, unknown> {
  fieldbeat_task_id: string;
  linked_zendesk_ticket_id: string;
  task_type: string;
  priority: number | "";
  state: string;
  description: string;
  client_key: string;
  assigned_to: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  start_time: string;
  duration_minutes: number | "";
  last_transition_at: string;
  finished_data_synced_at: string;
  created_in: string;
  extracted_at: string;
}

export interface FieldBeatClientRow extends Record<string, unknown> {
  client_key: string;
  client_name: string;
  rut: string;
  fieldbeat_client_name: string;
  address_raw: string;
  city: string;
  commune: string;
  country: string;
  latitude: string | number;
  longitude: string | number;
  updated_at: string;
}

export interface FieldBeatTaskEquipmentRow extends Record<string, unknown> {
  task_equipment_id: string;
  fieldbeat_task_id: string;
  equipment_uuid: string;
  equipment_internal_id: string;
  extracted_at: string;
}

export interface FieldBeatEquipmentDimRow extends Record<string, unknown> {
  equipment_key: string;
  equipment_uuid: string;
  internal_id: string;
  client_key: string;
  equipment_type: string;
  source_system: string;
  updated_at: string;
}

export interface FieldBeatReportFieldRow extends Record<string, unknown> {
  report_field_id: string;
  fieldbeat_task_id: string;
  group_name: string;
  group_index: number | string;
  group_copy_of: string;
  is_group_copy: boolean;
  field_name: string;
  field_index: number | string;
  field_type: string;
  field_value: unknown;
  mandatory: boolean;
  possible_values: string;
  etag: string;
  extracted_at: string;
}

export interface FieldBeatUsedPartRow extends Record<string, unknown> {
  used_part_id: string;
  fieldbeat_task_id: string;
  zendesk_ticket_id: string;
  part_number: string;
  part_name: string;
  quantity: number | "";
  raw_original_part_number: string;
  raw_original_part_name: string;
  origin_location: string;
  photo_ref: string;
  dolibarr_product_id: string;
  dolibarr_ref: string;
  unit_cost: string;
  estimated_total_cost: string;
  needs_manual_review: boolean;
  extracted_at: string;
}

export interface FieldBeatTicketBridgeRow extends Record<string, unknown> {
  bridge_id: string;
  zendesk_ticket_id: string;
  fieldbeat_task_id: string;
  link_method: string;
  confidence: number;
  created_at: string;
}

export interface FieldBeatNormalizedTables {
  tasks: FieldBeatTaskRow[];
  taskEquipments: FieldBeatTaskEquipmentRow[];
  reportFields: FieldBeatReportFieldRow[];
  usedParts: FieldBeatUsedPartRow[];
  clients: FieldBeatClientRow[];
  equipmentDim: FieldBeatEquipmentDimRow[];
  ticketBridge: FieldBeatTicketBridgeRow[];
}

// ---------------------------------------------------------------------
// Helpers puros - mismos nombres/comportamiento que fieldbeat-normalizer.js
// ---------------------------------------------------------------------

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function makeKey(...parts: unknown[]): string {
  return parts.map(part => String(part ?? "").trim()).join("|");
}

function toDateIso(value: string | number | undefined): string {
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

function safeNumber(value: unknown): number | "" {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isNaN(n) ? "" : n;
}

function getGroups(task: FieldBeatRawTask): FieldBeatRawGroup[] {
  return task.report?.groups ?? [];
}

function getFieldValueFromGroup(group: FieldBeatRawGroup, targetName: string): unknown {
  const target = normalizeText(targetName);
  const field = (group.fields ?? []).find(f => normalizeText(f.name) === target);
  return field?.value || "";
}

function findFieldValue(task: FieldBeatRawTask, possibleNames: string[]): unknown {
  const normalizedTargets = possibleNames.map(normalizeText);

  for (const group of getGroups(task)) {
    for (const field of group.fields ?? []) {
      const fieldName = normalizeText(field.name);
      if (normalizedTargets.includes(fieldName)) return field.value || "";
    }
  }

  return "";
}

function extractZendeskTicketId(task: FieldBeatRawTask): string {
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

function extractTrabajoRealizado(task: FieldBeatRawTask): string {
  return String(
    findFieldValue(task, ["TRABAJO REALIZADO", "DESCRIPCIÓN DE LA INTERVENCIÓN", "DESCRIPCION DE LA INTERVENCION"]) ||
      ""
  );
}

function inferEquipmentType(internalId: string): string {
  const value = normalizeText(internalId);
  if (value.includes("linac")) return "LINAC";
  if (value.includes("braqui")) return "BRAQUITERAPIA";
  if (value.includes("ct")) return "CT";
  if (value.includes("rx")) return "RX";
  return "";
}

// Exportada para que el miner (src/workers/fieldbeat-miner.ts) pueda
// contar tareas de una pagina para logging, sin duplicar esta logica de
// navegacion de forma de payload - infraestructura reusando dominio, no
// al reves.
export function extractFieldBeatTasks(payload: FieldBeatRawPayload): FieldBeatRawTask[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function splitLines(value: unknown): string[] {
  return String(value ?? "")
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

// Detecta listas explicitamente numeradas ("1.- x", "2- y", ...) con
// indices estrictamente crecientes. Si cualquier linea no calza el patron,
// o los indices no son crecientes, se considera que NO es una lista (se
// devuelve null) y el valor se deja intacto en una sola fila. Esto evita
// explotar valores como "107043-11" (guion dentro del propio codigo, no un
// marcador de lista) o "motores: 123\ntornillo: 456" (lineas con
// etiqueta, no numero).
const NUMBERED_LINE_PATTERN = /^(\d{1,2})[.\-)]+\s*(.*)$/;

function tryParseNumberedList(rawValue: unknown): string[] | null {
  const lines = splitLines(rawValue);
  if (lines.length < 2) return null;

  const parsed: string[] = [];
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

interface ExplodedUsedPartItem {
  partNumber: string;
  partName: string;
  quantity: number | "";
  needsManualReview: boolean;
}

// CRITICO - explota part_number en items atomicos cuando es una lista
// numerada. part_name y quantity se alinean por posicion SOLO si tambien
// son listas numeradas del mismo largo; si no, se mantienen sin partir y
// la fila queda marcada needsManualReview para revision humana. Puerto
// literal de explodeUsedPartItems() - no tocar sin releer
// fieldbeat-normalizer.js primero.
function explodeUsedPartItems(params: {
  rawPartNumber: unknown;
  rawPartName: unknown;
  rawQuantity: unknown;
}): ExplodedUsedPartItem[] {
  const { rawPartNumber, rawPartName, rawQuantity } = params;
  const partNumberList = tryParseNumberedList(rawPartNumber);

  if (!partNumberList) {
    return [
      {
        partNumber: String(rawPartNumber ?? ""),
        partName: String(rawPartName ?? ""),
        quantity: safeNumber(rawQuantity),
        needsManualReview: false
      }
    ];
  }

  const partNameList = tryParseNumberedList(rawPartName);
  const quantityList = tryParseNumberedList(rawQuantity);

  const partNameAligned = Boolean(partNameList) && partNameList!.length === partNumberList.length;
  const quantityAligned = Boolean(quantityList) && quantityList!.length === partNumberList.length;

  const singleQuantity = safeNumber(rawQuantity);
  const applySingleQuantityToAll = !quantityAligned && singleQuantity === 1;

  return partNumberList.map((partNumber, position) => {
    const partName = partNameAligned ? partNameList![position] : String(rawPartName ?? "");

    const quantity = quantityAligned
      ? safeNumber(quantityList![position])
      : applySingleQuantityToAll
        ? 1
        : "";

    const needsManualReview =
      (!partNameAligned && Boolean(rawPartName)) || (!quantityAligned && !applySingleQuantityToAll && Boolean(rawQuantity));

    return { partNumber, partName, quantity, needsManualReview };
  });
}

function dedupeByKey<T extends Record<string, unknown>>(rows: T[], keyField: keyof T): T[] {
  const byKey = new Map<unknown, T>();
  for (const row of rows) {
    const key = row[keyField];
    if (!key) continue;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

export class FieldBeatNormalizer {
  normalize(payload: FieldBeatRawPayload, extractedAt: string = new Date().toISOString()): FieldBeatNormalizedTables {
    const tasks = extractFieldBeatTasks(payload);

    const taskRows: FieldBeatTaskRow[] = [];
    const equipmentRows: FieldBeatTaskEquipmentRow[] = [];
    const reportFieldRows: FieldBeatReportFieldRow[] = [];
    const usedPartRows: FieldBeatUsedPartRow[] = [];
    const clientRows: FieldBeatClientRow[] = [];
    const equipmentDimRows: FieldBeatEquipmentDimRow[] = [];
    const bridgeRows: FieldBeatTicketBridgeRow[] = [];

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
          address_raw: task.client.address?.raw_address || "",
          city: task.client.address?.city || "",
          commune: task.client.address?.commune || "",
          country: task.client.address?.country || "",
          latitude: task.client.address?.latitude || "",
          longitude: task.client.address?.longitude || "",
          updated_at: extractedAt
        });
      }

      for (const eq of task.equipments ?? []) {
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
        for (const field of group.fields ?? []) {
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

      const repuestoGroups = getGroups(task).filter(group => normalizeText(group.name).startsWith("repuestos"));

      for (const group of repuestoGroups) {
        const rawPartNumber =
          getFieldValueFromGroup(group, "NÚMERO DE PARTE (Leer código de barra del repuesto)") ||
          getFieldValueFromGroup(group, "NUMERO DE PARTE") ||
          getFieldValueFromGroup(group, "NÚMERO DE PARTE");

        const rawPartName =
          getFieldValueFromGroup(group, "NOMBRE DEL REPUESTO O INSUMO UTILIZADO") ||
          getFieldValueFromGroup(group, "NOMBRE DEL REPUESTO");

        const rawQuantity =
          getFieldValueFromGroup(group, "CANTIDAD DE REPUESTOS UTILIZADOS") || getFieldValueFromGroup(group, "CANTIDAD");

        const originLocation =
          getFieldValueFromGroup(group, "UBICACIÓN DE ORIGEN DE REPUESTO") ||
          getFieldValueFromGroup(group, "UBICACION DE ORIGEN DE REPUESTO");

        const photoRef = getFieldValueFromGroup(group, "FOTO DEL REPUESTO UTILIZADO");

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
            raw_original_part_number: String(rawPartNumber ?? ""),
            raw_original_part_name: String(rawPartName ?? ""),
            origin_location: String(originLocation ?? ""),
            photo_ref: String(photoRef ?? ""),
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
      tasks: dedupeByKey(taskRows, "fieldbeat_task_id"),
      taskEquipments: dedupeByKey(equipmentRows, "task_equipment_id"),
      reportFields: dedupeByKey(reportFieldRows, "report_field_id"),
      usedParts: dedupeByKey(usedPartRows, "used_part_id"),
      clients: dedupeByKey(clientRows, "client_key"),
      equipmentDim: dedupeByKey(equipmentDimRows, "equipment_key"),
      ticketBridge: dedupeByKey(bridgeRows, "bridge_id")
    };
  }
}
