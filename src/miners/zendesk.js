import "dotenv/config";
import { fileURLToPath } from "node:url";
import { getJson, basicAuth } from "../lib/http.js";
import { saveJson, timestampForFile } from "../lib/save-json.js";

const {
  ZENDESK_URL,
  ZENDESK_USER,
  ZENDESK_TOKEN
} = process.env;

const BATCH_SIZE = 100;
const MAX_PAGES = 10;

export async function mineZendeskTickets() {
  if (!ZENDESK_URL || !ZENDESK_USER || !ZENDESK_TOKEN) {
    throw new Error("Faltan variables ZENDESK_URL, ZENDESK_USER o ZENDESK_TOKEN en .env");
  }

  const query = encodeURIComponent("type:ticket order_by:updated_at sort:asc");

  let nextUrl =
    `${ZENDESK_URL}/api/v2/search.json?query=${query}&per_page=${BATCH_SIZE}`;

  const authHeader = basicAuth(`${ZENDESK_USER}/token`, ZENDESK_TOKEN);

  let page = 1;
  let total = 0;
  let pagesFetched = 0;

  while (nextUrl && page <= MAX_PAGES) {
    console.log(`Zendesk página ${page}: ${nextUrl}`);

    const data = await getJson(nextUrl, {
      headers: {
        Authorization: authHeader
      }
    });

    const tickets = data.results || [];
    total += tickets.length;
    pagesFetched++;

    await saveJson(
      `data/raw/zendesk/search_page_${page}_${timestampForFile()}.json`,
      data
    );

    nextUrl = data.next_page;
    page++;
  }

  const truncatedByPageLimit = Boolean(nextUrl);

  console.log(`Zendesk finalizado. Tickets descargados: ${total}`);
  if (truncatedByPageLimit) {
    console.log(`ADVERTENCIA: se alcanzó MAX_PAGES=${MAX_PAGES} con más páginas disponibles - descarga incompleta.`);
  }

  return { total, pagesFetched, truncatedByPageLimit };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  mineZendeskTickets().catch(error => {
    console.error(error);
    process.exit(1);
  });
}