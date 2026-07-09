// Nucleo de dominio - normalizacion de Zendesk RAW a tablas tipadas.
// Transplante literal de src/normalizers/zendesk-normalizer.js (pipeline
// local): mismo mapeo de campos, misma deduplicacion, mismas claves
// compuestas. Ninguna regla de negocio se reescribe "a ojo" - cada campo
// de abajo tiene su contraparte exacta en el script heredado.
//
// PURO a proposito: no importa nada de R2/Queues/Cloudflare, no hace I/O,
// no lee el reloj salvo el parametro `extractedAt` (inyectado, nunca
// leido directo de Date.now() adentro). Recibe estructuras de datos,
// devuelve estructuras de datos - quien lee el RAW y escribe el PROCESSED
// es src/use-cases/process-zendesk-raw.ts, no este archivo.

// ---------------------------------------------------------------------
// Entrada: forma cruda de un ticket de Zendesk (API v2)
// ---------------------------------------------------------------------

export interface ZendeskRawVia {
  channel?: string;
}

export interface ZendeskRawSatisfactionRating {
  score?: string | number;
}

export interface ZendeskRawCustomField {
  id?: number | string;
  // El valor de un custom field de Zendesk es polimorfico segun el tipo
  // de campo (texto, numero, booleano, multiselect -> array, etc.) - el
  // script heredado tampoco lo restringe, solo lo pasa tal cual salvo
  // null/undefined -> "".
  value?: unknown;
}

export interface ZendeskRawTicket {
  id?: number | string;
  external_id?: string;
  type?: string;
  subject?: string;
  raw_subject?: string;
  description?: string;
  priority?: string;
  status?: string;
  via?: ZendeskRawVia;
  requester_id?: number;
  submitter_id?: number;
  assignee_id?: number;
  organization_id?: number;
  group_id?: number;
  is_public?: boolean;
  has_incidents?: boolean;
  due_at?: string;
  satisfaction_rating?: ZendeskRawSatisfactionRating;
  ticket_form_id?: number;
  brand_id?: number;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  custom_fields?: ZendeskRawCustomField[];
}

// El endpoint de busqueda (search.json, el que usa el Cron ingestor - ver
// src/workers/zendesk-miner.ts) devuelve { results: [...] }; el endpoint
// de ticket individual (tickets/{id}.json, usado por un backfill puntual)
// devuelve { ticket: {...} } singular. El dominio soporta ambas formas
// igual que el script heredado - la Fase 2 solo produce la primera, pero
// la regla de negocio de aceptar la segunda no se pierde en el transplante.
export interface ZendeskSearchPayload {
  results?: ZendeskRawTicket[];
}

export interface ZendeskSingleTicketPayload {
  ticket?: ZendeskRawTicket;
}

export type ZendeskRawPayload = ZendeskSearchPayload | ZendeskSingleTicketPayload;

// ---------------------------------------------------------------------
// Salida: filas tipadas para los 3 CSV que produce este modulo -
// DB_Zendesk_Tickets / DB_Zendesk_Ticket_Tags / DB_Zendesk_Custom_Fields
// en el pipeline local, mismos nombres de columna.
// ---------------------------------------------------------------------

// Las 3 interfaces de salida extienden Record<string, unknown> a
// proposito: viajan hacia toCsv()/writeCsv() (src/lib/storage.ts) y hacia
// dedupeByKey() de mas abajo, que indexan filas por nombre de columna en
// runtime - sin el index signature, TypeScript estricto no las deja pasar
// ahi (mismo motivo por el que Record<string, unknown> es el tipo de fila
// que toCsv() acepta).
export interface ZendeskTicketRow extends Record<string, unknown> {
  zendesk_ticket_id: string;
  external_id: string;
  type: string;
  subject: string;
  raw_subject: string;
  description: string;
  priority: string;
  status: string;
  via_channel: string;
  requester_id: number | "";
  submitter_id: number | "";
  assignee_id: number | "";
  organization_id: number | "";
  group_id: number | "";
  is_public: boolean;
  has_incidents: boolean;
  due_at: string;
  satisfaction_rating: string | number | "";
  ticket_form_id: number | "";
  brand_id: number | "";
  created_at: string;
  updated_at: string;
  extracted_at: string;
}

export interface ZendeskTicketTagRow extends Record<string, unknown> {
  ticket_tag_id: string;
  zendesk_ticket_id: string;
  tag: string;
  extracted_at: string;
}

export interface ZendeskCustomFieldRow extends Record<string, unknown> {
  ticket_custom_field_id: string;
  zendesk_ticket_id: string;
  field_id: number | string;
  field_value: unknown;
  extracted_at: string;
}

export interface ZendeskNormalizedTables {
  tickets: ZendeskTicketRow[];
  tags: ZendeskTicketTagRow[];
  customFields: ZendeskCustomFieldRow[];
}

function makeCompositeKey(...parts: unknown[]): string {
  return parts.map(part => String(part ?? "").trim()).join("|");
}

function extractTickets(payload: ZendeskRawPayload): ZendeskRawTicket[] {
  if ("results" in payload && Array.isArray(payload.results)) return payload.results;
  if ("ticket" in payload && payload.ticket) return [payload.ticket];
  return [];
}

// Dedupe por clave natural, quedandose con la ULTIMA ocurrencia - mismo
// comportamiento que dedupeBy()/Map en el script heredado. Filas sin clave
// (falsy) se descartan, no se agregan con clave vacia.
function dedupeByKey<T extends Record<string, unknown>>(rows: T[], keyField: keyof T): T[] {
  const byKey = new Map<unknown, T>();
  for (const row of rows) {
    const key = row[keyField];
    if (!key) continue;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

// Unico punto de entrada del modulo. Sincrono y puro: el mismo payload de
// entrada (y el mismo `extractedAt`) siempre produce exactamente las
// mismas 3 tablas.
export class ZendeskNormalizer {
  normalize(payload: ZendeskRawPayload, extractedAt: string = new Date().toISOString()): ZendeskNormalizedTables {
    const tickets = extractTickets(payload);

    const ticketRows: ZendeskTicketRow[] = [];
    const tagRows: ZendeskTicketTagRow[] = [];
    const customFieldRows: ZendeskCustomFieldRow[] = [];

    for (const ticket of tickets) {
      const ticketId = String(ticket.id ?? "").trim();
      if (!ticketId) continue;

      ticketRows.push({
        zendesk_ticket_id: ticketId,
        external_id: ticket.external_id || "",
        type: ticket.type || "",
        subject: ticket.subject || "",
        raw_subject: ticket.raw_subject || "",
        description: ticket.description || "",
        priority: ticket.priority || "",
        status: ticket.status || "",
        via_channel: ticket.via?.channel || "",
        requester_id: ticket.requester_id ?? "",
        submitter_id: ticket.submitter_id ?? "",
        assignee_id: ticket.assignee_id ?? "",
        organization_id: ticket.organization_id ?? "",
        group_id: ticket.group_id ?? "",
        is_public: Boolean(ticket.is_public),
        has_incidents: Boolean(ticket.has_incidents),
        due_at: ticket.due_at || "",
        satisfaction_rating: ticket.satisfaction_rating?.score ?? "",
        ticket_form_id: ticket.ticket_form_id ?? "",
        brand_id: ticket.brand_id ?? "",
        created_at: ticket.created_at || "",
        updated_at: ticket.updated_at || "",
        extracted_at: extractedAt
      });

      for (const tag of ticket.tags ?? []) {
        if (!tag) continue;
        tagRows.push({
          ticket_tag_id: makeCompositeKey(ticketId, tag),
          zendesk_ticket_id: ticketId,
          tag,
          extracted_at: extractedAt
        });
      }

      for (const field of ticket.custom_fields ?? []) {
        if (field?.id === undefined || field?.id === null) continue;
        customFieldRows.push({
          ticket_custom_field_id: makeCompositeKey(ticketId, field.id),
          zendesk_ticket_id: ticketId,
          field_id: field.id,
          field_value: field.value === null || field.value === undefined ? "" : field.value,
          extracted_at: extractedAt
        });
      }
    }

    return {
      tickets: dedupeByKey(ticketRows, "zendesk_ticket_id"),
      tags: dedupeByKey(tagRows, "ticket_tag_id"),
      customFields: dedupeByKey(customFieldRows, "ticket_custom_field_id")
    };
  }
}
