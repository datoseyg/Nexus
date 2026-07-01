import fs from "node:fs/promises";
import path from "node:path";
import { writeCsv } from "../lib/csv.js";

const RAW_DIR = "data/raw/zendesk";
const OUTPUT_DIR = "data/processed/zendesk";

function makeKey(...parts) {
  return parts
    .map(x => String(x ?? "").trim())
    .join("|");
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isNaN(n) ? "" : n;
}

async function loadAllTickets() {
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json"));

  const ticketsById = new Map();

  for (const file of files) {
    const raw = await fs.readFile(path.join(RAW_DIR, file), "utf8");
    const payload = JSON.parse(raw);
    const results = Array.isArray(payload.results) ? payload.results : [];

    for (const ticket of results) {
      if (ticket?.id === undefined || ticket?.id === null) continue;
      ticketsById.set(String(ticket.id), ticket);
    }
  }

  return Array.from(ticketsById.values());
}

function buildZendeskTables(tickets) {
  const ticketRows = [];
  const tagRows = [];
  const customFieldRows = [];

  const extractedAt = new Date().toISOString();

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
      satisfaction_rating: ticket.satisfaction_rating?.score || "",
      ticket_form_id: ticket.ticket_form_id ?? "",
      brand_id: ticket.brand_id ?? "",
      created_at: ticket.created_at || "",
      updated_at: ticket.updated_at || "",
      extracted_at: extractedAt
    });

    for (const tag of ticket.tags || []) {
      if (!tag) continue;

      tagRows.push({
        ticket_tag_id: makeKey(ticketId, tag),
        zendesk_ticket_id: ticketId,
        tag,
        extracted_at: extractedAt
      });
    }

    for (const field of ticket.custom_fields || []) {
      if (field?.id === undefined || field?.id === null) continue;

      customFieldRows.push({
        ticket_custom_field_id: makeKey(ticketId, field.id),
        zendesk_ticket_id: ticketId,
        field_id: field.id,
        field_value: field.value === null || field.value === undefined ? "" : field.value,
        extracted_at: extractedAt
      });
    }
  }

  return { ticketRows, tagRows, customFieldRows };
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

async function normalizeZendesk() {
  console.log("=== Normalizando Zendesk RAW ===");

  const tickets = await loadAllTickets();
  console.log(`Tickets únicos leídos desde RAW: ${tickets.length}`);

  const tables = buildZendeskTables(tickets);

  await writeCsv(`${OUTPUT_DIR}/DB_Zendesk_Tickets.csv`, dedupeBy(tables.ticketRows, "zendesk_ticket_id"));
  await writeCsv(`${OUTPUT_DIR}/DB_Zendesk_Ticket_Tags.csv`, dedupeBy(tables.tagRows, "ticket_tag_id"));
  await writeCsv(`${OUTPUT_DIR}/DB_Zendesk_Custom_Fields.csv`, dedupeBy(tables.customFieldRows, "ticket_custom_field_id"));

  console.log("=== Normalización Zendesk finalizada ===");
}

normalizeZendesk().catch(error => {
  console.error("ERROR NORMALIZANDO ZENDESK:");
  console.error(error);
  process.exit(1);
});
