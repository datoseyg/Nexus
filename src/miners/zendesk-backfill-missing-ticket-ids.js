import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basicAuth } from "../lib/http.js";
import { saveJson, timestampForFile } from "../lib/save-json.js";
import { readCsv, writeCsv } from "../lib/csv.js";

const { ZENDESK_URL, ZENDESK_USER, ZENDESK_TOKEN } = process.env;

const MISSING_TICKETS_FILE = "data/reports/fieldbeat_tasks_linked_to_missing_zendesk_ticket.csv";
const RAW_OUTPUT_DIR = "data/raw/zendesk/backfill_by_fieldbeat_ticket_ids";
const SUMMARY_FILE = "data/reports/zendesk_backfill_by_fieldbeat_summary.json";
const NOT_FOUND_FILE = "data/reports/zendesk_ticket_ids_not_found_after_backfill.csv";

const REQUEST_DELAY_MS = 300;

function assertEnv() {
  if (!ZENDESK_URL || !ZENDESK_USER || !ZENDESK_TOKEN) {
    throw new Error("Faltan variables ZENDESK_URL, ZENDESK_USER o ZENDESK_TOKEN en .env");
  }
}

function cleanId(value) {
  return String(value ?? "").trim();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// A diferencia de getJson (lib/http.js), acá necesitamos el status code
// crudo para distinguir 404 (ticket no existe, esperado y no fatal) de
// cualquier otro error (rechazo de auth, 5xx, red caída, etc).
async function fetchZendeskTicket(ticketId, authHeader) {
  const url = `${ZENDESK_URL}/api/v2/tickets/${ticketId}.json`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader
      }
    });

    const text = await response.text();

    if (response.status === 404) {
      return { status: "NOT_FOUND" };
    }

    if (!response.ok) {
      return { status: "ERROR", error: `${response.status} ${response.statusText}: ${text}` };
    }

    return { status: "FOUND", data: JSON.parse(text) };
  } catch (error) {
    return { status: "ERROR", error: error.message };
  }
}

export async function backfillMissingZendeskTickets() {
  assertEnv();

  console.log("=== Backfill Zendesk por ticket_id detectados desde FieldBeat ===");

  const missingRelations = await readCsv(MISSING_TICKETS_FILE);
  console.log(`Relaciones FieldBeat->ticket faltante leidas: ${missingRelations.length}`);

  const uniqueTicketIds = Array.from(
    new Set(missingRelations.map(row => cleanId(row.missing_zendesk_ticket_id)).filter(Boolean))
  );

  console.log(`Ticket IDs únicos a buscar en Zendesk: ${uniqueTicketIds.length}`);

  const authHeader = basicAuth(`${ZENDESK_USER}/token`, ZENDESK_TOKEN);

  const foundTicketIds = [];
  const notFoundTicketIds = [];
  const failedTicketIds = [];

  for (const ticketId of uniqueTicketIds) {
    console.log(`Consultando Zendesk ticket ${ticketId}...`);

    const result = await fetchZendeskTicket(ticketId, authHeader);

    if (result.status === "FOUND") {
      foundTicketIds.push(ticketId);

      await saveJson(
        `${RAW_OUTPUT_DIR}/ticket_${ticketId}_${timestampForFile()}.json`,
        result.data
      );
    } else if (result.status === "NOT_FOUND") {
      console.warn(`Ticket ${ticketId}: no encontrado (404)`);
      notFoundTicketIds.push(ticketId);
    } else {
      console.warn(`Ticket ${ticketId}: error - ${result.error}`);
      failedTicketIds.push({ ticketId, error: result.error });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const notFoundRows = [
    ...notFoundTicketIds.map(id => ({ zendesk_ticket_id: id, status: "NOT_FOUND", error_detail: "" })),
    ...failedTicketIds.map(f => ({ zendesk_ticket_id: f.ticketId, status: "ERROR", error_detail: f.error }))
  ];

  await writeCsv(NOT_FOUND_FILE, notFoundRows);

  const summary = {
    generated_at: new Date().toISOString(),
    missing_ticket_relations_input: missingRelations.length,
    unique_missing_ticket_ids: uniqueTicketIds.length,
    tickets_found_in_zendesk: foundTicketIds.length,
    tickets_not_found: notFoundTicketIds.length,
    tickets_failed_by_error: failedTicketIds.length,
    found_rate: uniqueTicketIds.length
      ? `${((foundTicketIds.length / uniqueTicketIds.length) * 100).toFixed(2)}%`
      : "0.00%"
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`Tickets no encontrados/fallidos: ${NOT_FOUND_FILE}`);
  console.log("=== Backfill finalizado ===");

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  backfillMissingZendeskTickets().catch(error => {
    console.error("ERROR EN BACKFILL ZENDESK:");
    console.error(error);
    process.exit(1);
  });
}
