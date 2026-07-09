// Caso de uso: orquesta la Fase 4 del blueprint (capa MARTS) con el
// Patron Fan-In. Es la UNICA capa que conoce tanto al dominio (los tres
// constructores de src/domain/marts/*.ts y PartIdentityResolver) como a la
// infraestructura (StorageAdapter) - ninguno de los dos se conoce entre
// si, misma separacion que process-*-raw.ts para PROCESSED. Quien invoca
// esto es src/workers/queue-router.ts, al recibir CUALQUIERA de los tres
// eventos *_PROCESSED_READY en marts-queue.
//
// Patron Fan-In: Zendesk, FieldBeat y Dolibarr terminan su normalizacion
// en momentos independientes - este caso de uso no le presta atencion a
// cual de los tres domino evento la desperto (ver processMartsMessage en
// queue-router.ts, que llama a buildMarts() igual para los tres). Cada
// invocacion intenta reunir el PROCESSED mas reciente de los TRES
// dominios; si falta cualquiera, aborta en silencio (`built: false`) en
// vez de lanzar - eso no es un error, es el estado normal mientras los
// tres pipelines convergen. El proximo evento *_PROCESSED_READY (del
// dominio que faltaba) dispara un reintento que sí puede completar.

import { readCsv, toCsv, type StorageAdapter } from "../lib/storage";
import { findLatestRunKey, makeRunKey } from "../lib/latest-run";
import type { GoldQueueMessage } from "../lib/messages";
import {
  PartIdentityResolver,
  type DolibarrIdentityEntry,
  type PartIdentityAliasEntry
} from "../domain/resolvers/part-identity-resolver";
import { buildUsedPartsDolibarrMatch, type UsedPartSourceRow } from "../domain/marts/used-parts-match";
import {
  buildTicketFieldBeatOperationalView,
  type FieldBeatTaskEquipmentSourceRow,
  type FieldBeatTaskSourceRow,
  type FieldBeatTicketBridgeSourceRow,
  type ZendeskTicketSourceRow
} from "../domain/marts/ticket-fieldbeat-view";
import { buildTicketFieldBeatDolibarrView } from "../domain/marts/ticket-fieldbeat-dolibarr-view";

export interface BuildMartsDeps {
  storage: StorageAdapter;
  // Cola de SALIDA de este caso de uso - gold-queue (ver messages.ts:
  // MARTS_PROCESSED_READY viaja ahi, no de vuelta a marts-queue). Mismo
  // patron de nombre que process-*-raw.ts.
  outputQueue: Queue<GoldQueueMessage>;
}

export interface BuildMartsResult {
  built: boolean;
  // Motivo de aborto legible para logging (ver queue-router.ts) - nunca se
  // usa para decidir logica, solo para observabilidad.
  reason?: string;
  usedPartsMatchPath?: string;
  ticketFieldBeatViewPath?: string;
  ticketFieldBeatDolibarrViewPath?: string;
  ticketCount?: number;
  usedPartsCount?: number;
}

const ZENDESK_PREFIX = "processed/zendesk/";
const FIELDBEAT_PREFIX = "processed/fieldbeat/";
const DOLIBARR_PREFIX = "processed/dolibarr/";

// Diccionario de alias manuales - config curada a mano, no un output de
// ningun normalizador. A diferencia de las tablas PROCESSED de abajo, su
// ausencia NO aborta el build: sin alias la cascada automatica del
// resolver simplemente no tiene ese atajo, sigue funcionando igual (ver
// PartIdentityResolver).
const ALIAS_CONFIG_PATH = "config/part_identity_aliases.csv";

const ZENDESK_TICKETS_FILE = "DB_Zendesk_Tickets.csv";
const FIELDBEAT_TASKS_FILE = "DB_FieldBeat_Tasks.csv";
const FIELDBEAT_TASK_EQUIPMENTS_FILE = "DB_FieldBeat_Task_Equipments.csv";
const FIELDBEAT_USED_PARTS_FILE = "DB_FieldBeat_Used_Parts.csv";
const FIELDBEAT_TICKET_BRIDGE_FILE = "BR_Ticket_FieldBeat_Task.csv";
const DOLIBARR_IDENTITY_MAP_FILE = "DIM_Dolibarr_Product_Identity_Map.csv";

const MARTS_PREFIX = "marts/";

// Nombres base de los 3 MARTS - el prefijo completo de salida se arma en
// buildMarts() como `${MARTS_PREFIX}${martsRunKey}/${*_FILE}`. MARTS, igual
// que RAW/PROCESSED, es inmutable y particionado por runKey (nunca se
// sobreescribe un archivo existente) - así build-gold.ts puede descubrir
// "el MARTS mas reciente" con el mismo patron findLatestRunKey() que este
// caso de uso ya usa para descubrir el PROCESSED mas reciente de cada
// dominio, y cualquier build de GOLD queda trazable al runKey exacto de
// MARTS que lo origino.
const USED_PARTS_MATCH_FILE = "Used_Parts_Dolibarr_Match.csv";
const TICKET_FIELDBEAT_VIEW_FILE = "Ticket_FieldBeat_Operational_View.csv";
const TICKET_FIELDBEAT_DOLIBARR_VIEW_FILE = "Ticket_FieldBeat_Dolibarr_Operational_View.csv";

interface DomainTableResult<T> {
  rows: T[];
  found: boolean;
}

// Cada *-miner.ts particiona su salida en `page-N/` (una pagina de la API
// de origen = una unidad de normalizacion independiente, ver
// process-*-raw.ts) - "la tabla mas reciente" de un dominio es entonces la
// UNION de esa misma tabla a traves de TODAS las paginas del runKey mas
// nuevo, no un unico archivo. Se listan las claves bajo ese runKey UNA vez
// y se filtran por nombre de archivo, en vez de adivinar cuantas paginas
// hubo o leerlas una por una con gets independientes sin listar antes.
async function readLatestDomainTable<T extends Record<string, string>>(
  storage: StorageAdapter,
  domainPrefix: string,
  runKey: string,
  fileName: string
): Promise<DomainTableResult<T>> {
  const keys = await storage.list(`${domainPrefix}${runKey}/`);
  const matchingKeys = keys.filter(key => key.endsWith(`/${fileName}`));

  if (matchingKeys.length === 0) return { rows: [], found: false };

  // Las paginas de un mismo runKey son independientes entre si - se leen
  // en paralelo (Promise.all) en vez de secuencialmente, el orden de
  // llegada no importa porque el resultado se aplana en un unico array.
  const pages = await Promise.all(matchingKeys.map(key => readCsv(storage, key)));
  return { rows: pages.flat() as T[], found: true };
}

export async function buildMarts(deps: BuildMartsDeps): Promise<BuildMartsResult> {
  const { storage, outputQueue } = deps;

  const [zendeskKeys, fieldbeatKeys, dolibarrKeys] = await Promise.all([
    storage.list(ZENDESK_PREFIX),
    storage.list(FIELDBEAT_PREFIX),
    storage.list(DOLIBARR_PREFIX)
  ]);

  const zendeskRunKey = findLatestRunKey(zendeskKeys, ZENDESK_PREFIX);
  if (!zendeskRunKey) return { built: false, reason: "Sin PROCESSED de Zendesk todavia." };

  const fieldbeatRunKey = findLatestRunKey(fieldbeatKeys, FIELDBEAT_PREFIX);
  if (!fieldbeatRunKey) return { built: false, reason: "Sin PROCESSED de FieldBeat todavia." };

  const dolibarrRunKey = findLatestRunKey(dolibarrKeys, DOLIBARR_PREFIX);
  if (!dolibarrRunKey) return { built: false, reason: "Sin PROCESSED de Dolibarr todavia." };

  const [tickets, tasks, taskEquipments, usedParts, bridgeRows, identityMap] = await Promise.all([
    readLatestDomainTable<ZendeskTicketSourceRow>(storage, ZENDESK_PREFIX, zendeskRunKey, ZENDESK_TICKETS_FILE),
    readLatestDomainTable<FieldBeatTaskSourceRow>(storage, FIELDBEAT_PREFIX, fieldbeatRunKey, FIELDBEAT_TASKS_FILE),
    readLatestDomainTable<FieldBeatTaskEquipmentSourceRow>(
      storage,
      FIELDBEAT_PREFIX,
      fieldbeatRunKey,
      FIELDBEAT_TASK_EQUIPMENTS_FILE
    ),
    readLatestDomainTable<UsedPartSourceRow>(storage, FIELDBEAT_PREFIX, fieldbeatRunKey, FIELDBEAT_USED_PARTS_FILE),
    readLatestDomainTable<FieldBeatTicketBridgeSourceRow>(
      storage,
      FIELDBEAT_PREFIX,
      fieldbeatRunKey,
      FIELDBEAT_TICKET_BRIDGE_FILE
    ),
    readLatestDomainTable<DolibarrIdentityEntry>(storage, DOLIBARR_PREFIX, dolibarrRunKey, DOLIBARR_IDENTITY_MAP_FILE)
  ]);

  const essentialTables: Array<DomainTableResult<unknown>> = [tickets, tasks, taskEquipments, usedParts, bridgeRows, identityMap];
  if (essentialTables.some(table => !table.found)) {
    return { built: false, reason: "Falta al menos una tabla PROCESSED esencial en el runKey mas reciente de algun dominio." };
  }

  // Config opcional (ver comentario junto a ALIAS_CONFIG_PATH) - readCsv
  // ya devuelve [] si la clave no existe en el storage, no hace falta un
  // chequeo de "found" adicional acá.
  const aliasRows = (await readCsv(storage, ALIAS_CONFIG_PATH)) as PartIdentityAliasEntry[];

  const resolver = new PartIdentityResolver(identityMap.rows, aliasRows);
  const usedPartsMatch = buildUsedPartsDolibarrMatch(usedParts.rows, resolver);

  const operationalView = buildTicketFieldBeatOperationalView({
    tickets: tickets.rows,
    tasks: tasks.rows,
    taskEquipments: taskEquipments.rows,
    usedParts: usedParts.rows,
    bridgeRows: bridgeRows.rows
  });

  const dolibarrView = buildTicketFieldBeatDolibarrView(operationalView, usedPartsMatch);

  // runKey generado UNA vez acá (no por dominio, como en PROCESSED) - los
  // 3 MARTS de esta corrida son un snapshot conjunto y coherente entre si
  // (se calcularon a partir de EXACTAMENTE los mismos PROCESSED leidos
  // arriba), así que comparten el mismo runKey de salida.
  const martsRunKey = makeRunKey();
  const martsPrefix = `${MARTS_PREFIX}${martsRunKey}/`;
  const usedPartsMatchPath = `${martsPrefix}${USED_PARTS_MATCH_FILE}`;
  const ticketFieldBeatViewPath = `${martsPrefix}${TICKET_FIELDBEAT_VIEW_FILE}`;
  const ticketFieldBeatDolibarrViewPath = `${martsPrefix}${TICKET_FIELDBEAT_DOLIBARR_VIEW_FILE}`;

  // Los tres MARTS se escriben en paralelo - son salidas independientes,
  // ninguna depende de que las otras ya esten en R2.
  await Promise.all([
    storage.put(usedPartsMatchPath, toCsv(usedPartsMatch), "text/csv"),
    storage.put(ticketFieldBeatViewPath, toCsv(operationalView), "text/csv"),
    storage.put(ticketFieldBeatDolibarrViewPath, toCsv(dolibarrView), "text/csv")
  ]);

  const message: GoldQueueMessage = {
    type: "MARTS_PROCESSED_READY",
    runKey: martsRunKey,
    usedPartsMatchPath,
    ticketFieldBeatViewPath,
    ticketFieldBeatDolibarrViewPath
  };
  await outputQueue.send(message);

  return {
    built: true,
    usedPartsMatchPath,
    ticketFieldBeatViewPath,
    ticketFieldBeatDolibarrViewPath,
    ticketCount: operationalView.length,
    usedPartsCount: usedPartsMatch.length
  };
}
