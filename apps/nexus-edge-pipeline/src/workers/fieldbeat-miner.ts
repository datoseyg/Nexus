// Ingestor de FieldBeat - logica de negocio de la Fase 3B, disparada por
// Cron Trigger. Equivalente edge de src/miners/fieldbeat-all.js (pipeline
// local) - MISMO cursor de paginacion (next_page -> query param "page",
// nunca vía URLSearchParams porque el cursor ya viene URL-encoded).
//
// NOTA sobre el legado: src/miners/fieldbeat.js (el otro miner de
// FieldBeat en el pipeline local) es codigo muerto/roto - referencia una
// variable `taskId` que nunca se declara y no compila. El script real que
// usan `npm run get:fieldbeat:all`/`get:all` es fieldbeat-all.js, así que
// es ese el que se transplanta acá.

import { getJson, basicAuthHeader } from "../lib/http";
import { saveJson, type StorageAdapter } from "../lib/storage";
import { extractFieldBeatTasks, type FieldBeatRawPayload } from "../domain/normalizers/fieldbeat";
import type { NormalizationQueueMessage } from "../lib/messages";

export interface FieldBeatMinerEnv {
  FIELDBEAT_API_BASE_URL: string;
  FIELDBEAT_API_USER: string;
  FIELDBEAT_API_PASS: string;
  NORMALIZATION_QUEUE: Queue<NormalizationQueueMessage>;
}

// El legado (fieldbeat-all.js) permite hasta FIELDBEAT_MAX_PAGES=1000,
// corriendo en una maquina local sin limite de CPU por invocacion. Un
// Worker sí tiene ese limite - se acota a un numero razonable para una
// sola invocacion de `scheduled`; el resto de las paginas quedan para el
// proximo tick de cron (mismo criterio que MAX_PAGES_PER_RUN en
// zendesk-miner.ts).
const MAX_PAGES_PER_RUN = 20;

function buildFieldBeatUrl(baseUrl: string, nextPageToken: string): string {
  if (!nextPageToken) return baseUrl;
  // Igual que el legado: NO usar URLSearchParams, el cursor que devuelve
  // FieldBeat ya viene URL-encoded y re-encodearlo lo rompe.
  return `${baseUrl}?page=${nextPageToken}`;
}

function extractNextPage(payload: FieldBeatRawPayload): string {
  if (Array.isArray(payload)) return "";
  return payload.next_page ?? "";
}

export interface FieldBeatMinerResult {
  pagesFetched: number;
  tasksFetched: number;
}

// Idempotencia: misma logica que zendesk-miner.ts - la clave de R2 se
// deriva de `scheduledAt` (timestamp fijo del tick de cron), nunca de
// Date.now() calculado adentro. Un reintento de la misma invocacion de
// `scheduled` sobrescribe el mismo objeto en vez de duplicarlo. A
// diferencia del script local (que agregaba todas las tareas de todas las
// paginas en un unico all_tasks_latest.json con dedupe cruzado por
// seenTaskIds), acá cada pagina es su propia unidad RAW/PROCESSED
// independiente - el dedupe cruzado entre paginas/corridas se resuelve
// mas adelante, en la etapa de MARTS, no en la ingesta.
export async function mineFieldBeatTasks(
  env: FieldBeatMinerEnv,
  storage: StorageAdapter,
  scheduledAt: Date
): Promise<FieldBeatMinerResult> {
  if (!env.FIELDBEAT_API_BASE_URL || !env.FIELDBEAT_API_USER || !env.FIELDBEAT_API_PASS) {
    throw new Error(
      "Faltan bindings FIELDBEAT_API_BASE_URL/FIELDBEAT_API_USER/FIELDBEAT_API_PASS - la URL va en [vars] de " +
      "wrangler.toml, USER y PASS se configuran con `wrangler secret put`."
    );
  }

  const authHeader = basicAuthHeader(env.FIELDBEAT_API_USER, env.FIELDBEAT_API_PASS);
  const runKey = scheduledAt.toISOString().replace(/[:.]/g, "-");

  let nextPageToken = "";
  let page = 1;
  let tasksFetched = 0;

  while (page <= MAX_PAGES_PER_RUN) {
    const url = buildFieldBeatUrl(env.FIELDBEAT_API_BASE_URL, nextPageToken);
    const payload = await getJson<FieldBeatRawPayload>(url, {
      headers: { Authorization: authHeader }
    });

    tasksFetched += extractFieldBeatTasks(payload).length;

    const path = `raw/fieldbeat/${runKey}/page-${page}.json`;
    await saveJson(storage, path, payload);

    const message: NormalizationQueueMessage = { type: "FIELDBEAT_RAW_READY", path, page };
    await env.NORMALIZATION_QUEUE.send(message);

    nextPageToken = extractNextPage(payload);
    if (!nextPageToken) break;
    page += 1;
  }

  return { pagesFetched: page, tasksFetched };
}
