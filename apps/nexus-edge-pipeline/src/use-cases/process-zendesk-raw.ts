// Caso de uso: orquesta la normalizacion de un RAW de Zendesk ya
// existente en R2. Es la UNICA capa que conoce tanto al dominio
// (ZendeskNormalizer) como a la infraestructura (StorageAdapter, Queue) -
// ninguno de los dos se conoce entre si:
// - src/domain/normalizers/zendesk.ts no sabe que existe R2 ni Queues.
// - src/lib/storage.ts no sabe que existe Zendesk.
// Quien invoca esto es src/workers/queue-router.ts, al recibir un mensaje
// ZENDESK_RAW_READY en normalization-queue.

import { readJson, toCsv, type StorageAdapter } from "../lib/storage";
import { ZendeskNormalizer, type ZendeskRawPayload } from "../domain/normalizers/zendesk";
import type { ZendeskProcessedReadyMessage } from "../lib/messages";

export interface ProcessZendeskRawDeps {
  storage: StorageAdapter;
  // Cola de SALIDA de este caso de uso - conceptualmente es marts-queue
  // (ver messages.ts: ZENDESK_PROCESSED_READY viaja ahi, no de vuelta a
  // normalization-queue). Se llama `outputQueue`, no `normalizationQueue`,
  // para que el nombre del parametro no mienta sobre qué binding va acá.
  outputQueue: Queue<ZendeskProcessedReadyMessage>;
  // Inyectable para tests (un ZendeskNormalizer fake/espía) - Inversion de
  // Dependencias otra vez: este caso de uso depende de la clase publica,
  // pero nunca instancia una salvo que el llamador no le pase una.
  normalizer?: ZendeskNormalizer;
}

export interface ProcessZendeskRawResult {
  ticketsPath: string;
  tagsPath: string;
  customFieldsPath: string;
  ticketCount: number;
}

// `rawPath` es la clave R2 donde zendesk-miner.ts dejo el RAW (ej.
// "raw/zendesk/2026-07-08T06-00-00-000Z/page-1.json", ver
// ZendeskRawReadyMessage.path). El prefijo de PROCESSED se deriva de esa
// misma clave - ver deriveOutputPrefix() - nunca de un timestamp calculado
// en este paso, para que reprocesar el mismo mensaje (Queues entrega al
// menos una vez) escriba siempre el mismo prefijo en vez de acumular
// carpetas nuevas cada reintento.
export async function processZendeskRaw(rawPath: string, deps: ProcessZendeskRawDeps): Promise<ProcessZendeskRawResult> {
  const { storage, outputQueue } = deps;
  const normalizer = deps.normalizer ?? new ZendeskNormalizer();

  const payload = await readJson<ZendeskRawPayload>(storage, rawPath);
  if (payload === null) {
    throw new Error(`No existe el RAW "${rawPath}" en el storage - nada que normalizar.`);
  }

  const tables = normalizer.normalize(payload);

  const prefix = deriveOutputPrefix(rawPath);
  const ticketsPath = `${prefix}/DB_Zendesk_Tickets.csv`;
  const tagsPath = `${prefix}/DB_Zendesk_Ticket_Tags.csv`;
  const customFieldsPath = `${prefix}/DB_Zendesk_Custom_Fields.csv`;

  // Cada escritura es independiente. Si storage.put() falla, R2StorageAdapter
  // (ver src/lib/storage.ts) ya envuelve el error en StorageWriteError y lo
  // relanza - acá NO se atrapa con try/catch: la excepcion sube tal cual
  // hasta queue-router.ts, que es quien decide message.retry() vs dejar
  // que expire hacia la Dead Letter Queue. Un CSV que no se pudo escribir
  // nunca debe pasar en silencio.
  await storage.put(ticketsPath, toCsv(tables.tickets), "text/csv");
  await storage.put(tagsPath, toCsv(tables.tags), "text/csv");
  await storage.put(customFieldsPath, toCsv(tables.customFields), "text/csv");

  const message: ZendeskProcessedReadyMessage = {
    type: "ZENDESK_PROCESSED_READY",
    sourcePath: rawPath,
    ticketsPath,
    tagsPath,
    customFieldsPath
  };
  await outputQueue.send(message);

  return { ticketsPath, tagsPath, customFieldsPath, ticketCount: tables.tickets.length };
}

// "raw/zendesk/<runKey>/page-N.json" -> "processed/zendesk/<runKey>/page-N"
// Deterministico a partir del propio rawPath - ninguna llamada a
// Date.now()/crypto.randomUUID() acá, que es justo lo que rompería la
// idempotencia entre reintentos del mismo mensaje.
function deriveOutputPrefix(rawPath: string): string {
  const match = rawPath.match(/^raw\/zendesk\/(.+)\.json$/);
  if (!match) {
    throw new Error(`"${rawPath}" no tiene la forma esperada "raw/zendesk/<runKey>/page-N.json".`);
  }
  return `processed/zendesk/${match[1]}`;
}
