// Ingestor de Zendesk - logica de negocio de la Fase 2 (Desacoplamiento
// Temporal), disparada por Cron Trigger. Equivalente edge de
// src/miners/zendesk.js del pipeline local: mismo endpoint, misma
// paginacion vía `next_page`, mismo Basic Auth `${ZENDESK_USER}/token`.
//
// Separado de src/index.ts a proposito: este modulo es lógica de negocio
// pura (que hacer con la respuesta de Zendesk), el handler `scheduled` en
// index.ts es infraestructura (cuando correr esto, con qué env). Ninguno
// de los dos deberia tener que cambiar cuando cambia el otro.

import { getJson, basicAuthHeader } from "../lib/http";
import { saveJson, type StorageAdapter } from "../lib/storage";
import type { NormalizationQueueMessage } from "../lib/messages";

export interface ZendeskMinerEnv {
  ZENDESK_URL: string;
  ZENDESK_USER: string;
  ZENDESK_TOKEN: string;
  NORMALIZATION_QUEUE: Queue<NormalizationQueueMessage>;
}

const PAGE_SIZE = 100;

// Mismo limite que MAX_PAGES en src/miners/zendesk.js. Una invocacion de
// `scheduled` tiene un tiempo de CPU acotado - encadenar paginas sin limite
// arriesgaria cortar el Worker a mitad de una pagina. Si Zendesk devuelve
// mas de 10 paginas nuevas en una corrida, quedan para el proximo tick de
// cron (24 hrs despues) - aceptable para un feed de tickets, no para un
// feed que necesite latencia de minutos.
const MAX_PAGES_PER_RUN = 10;

interface ZendeskSearchResponse {
  results: unknown[];
  next_page: string | null;
}

export interface ZendeskMinerResult {
  pagesFetched: number;
  ticketsFetched: number;
}

// Idempotencia: la clave de R2 se deriva de `scheduledAt` - el timestamp
// FIJO del tick de cron (ScheduledController.scheduledTime en
// src/index.ts), nunca de `Date.now()` calculado adentro de esta funcion.
// Si Cloudflare reintenta esta misma invocacion de `scheduled` (el
// handler tiro una excepcion, por ejemplo), la clave que se escribe es
// identica a la del intento anterior - el reintento sobrescribe el mismo
// objeto en R2 en vez de crear un duplicado con otro nombre. Lo mismo para
// el mensaje de cola: se encola siempre con el mismo `path`, así que un
// consumidor que ya lo proceso puede detectarlo por esa clave (ver
// queue-router.ts).
export async function mineZendeskTickets(
  env: ZendeskMinerEnv,
  storage: StorageAdapter,
  scheduledAt: Date
): Promise<ZendeskMinerResult> {
  if (!env.ZENDESK_URL || !env.ZENDESK_USER || !env.ZENDESK_TOKEN) {
    throw new Error(
      "Faltan bindings ZENDESK_URL/ZENDESK_USER/ZENDESK_TOKEN - ZENDESK_URL va en [vars] de wrangler.toml, " +
      "USER y TOKEN se configuran con `wrangler secret put` (nunca en el archivo)."
    );
  }

  const authHeader = basicAuthHeader(`${env.ZENDESK_USER}/token`, env.ZENDESK_TOKEN);
  const runKey = scheduledAt.toISOString().replace(/[:.]/g, "-");
  const query = encodeURIComponent("type:ticket order_by:updated_at sort:asc");

  let nextUrl: string | null = `${env.ZENDESK_URL}/api/v2/search.json?query=${query}&per_page=${PAGE_SIZE}`;
  let page = 1;
  let ticketsFetched = 0;

  while (nextUrl && page <= MAX_PAGES_PER_RUN) {
    const data: ZendeskSearchResponse = await getJson<ZendeskSearchResponse>(nextUrl, {
      headers: { Authorization: authHeader }
    });

    ticketsFetched += data.results?.length ?? 0;

    // Una pagina = una unidad de trabajo de normalizacion independiente -
    // ver comentario de idempotencia arriba.
    const path = `raw/zendesk/${runKey}/page-${page}.json`;
    await saveJson(storage, path, data);

    const message: NormalizationQueueMessage = { type: "ZENDESK_RAW_READY", path, page };
    await env.NORMALIZATION_QUEUE.send(message);

    nextUrl = data.next_page ?? null;
    page += 1;
  }

  return { pagesFetched: page - 1, ticketsFetched };
}
