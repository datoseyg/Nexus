// Contrato compartido entre productores (src/workers/*-miner.ts,
// src/use-cases/*.ts) y consumidores (src/workers/queue-router.ts) de las
// colas del pipeline - ver wrangler.toml para los bindings. Uniones
// discriminadas por `type`: agregar un mensaje nuevo es agregar un
// miembro a la union y un `case` en el router, nunca modificar los
// existentes (Abierto/Cerrado).

export interface ZendeskRawReadyMessage {
  type: "ZENDESK_RAW_READY";
  path: string;
  page: number;
}

export interface FieldBeatRawReadyMessage {
  type: "FIELDBEAT_RAW_READY";
  path: string;
  page: number;
}

export interface DolibarrRawReadyMessage {
  type: "DOLIBARR_RAW_READY";
  path: string;
  page: number;
}

// Los 3 dominios (Zendesk, FieldBeat, Dolibarr) comparten normalization-queue
// - un unico consumidor (processNormalizationMessage en queue-router.ts)
// decide por `type` a que caso de uso delegar.
export type NormalizationQueueMessage = ZendeskRawReadyMessage | FieldBeatRawReadyMessage | DolibarrRawReadyMessage;

// Sin productores reales hacia ingestion-queue todavia (la ingesta hoy
// solo se dispara por Cron Trigger, ver src/index.ts) - la union queda
// deliberadamente abierta para cuando la Fase 3 agregue disparo de
// ingesta bajo demanda vía cola.
export type IngestionQueueMessage = { type: string } & Record<string, unknown>;

// Emitidos por los casos de uso process-*-raw.ts al terminar de
// normalizar un RAW - señalan "el/los CSV de PROCESSED ya existen en R2,
// listos para el siguiente escalon del medallon (MARTS)". Van a
// marts-queue, no de vuelta a normalization-queue: normalization-queue
// significa "hay un RAW para normalizar", marts-queue significa "hay un
// PROCESSED para construir marts" - son pasos distintos del pipeline, ver
// diagrama 01 de target-architecture-cloudflare.html.

export interface ZendeskProcessedReadyMessage {
  type: "ZENDESK_PROCESSED_READY";
  sourcePath: string;
  ticketsPath: string;
  tagsPath: string;
  customFieldsPath: string;
}

export interface FieldBeatProcessedReadyMessage {
  type: "FIELDBEAT_PROCESSED_READY";
  sourcePath: string;
  tasksPath: string;
  taskEquipmentsPath: string;
  reportFieldsPath: string;
  usedPartsPath: string;
  clientsPath: string;
  equipmentDimPath: string;
  ticketBridgePath: string;
}

export interface DolibarrProcessedReadyMessage {
  type: "DOLIBARR_PROCESSED_READY";
  sourcePath: string;
  productsPath: string;
  identitiesPath: string;
}

export type MartsQueueMessage = ZendeskProcessedReadyMessage | FieldBeatProcessedReadyMessage | DolibarrProcessedReadyMessage;

// Emitido por build-marts.ts (ver src/use-cases/build-marts.ts) al
// terminar de escribir los 3 MARTS - señala "el runKey de MARTS mas
// reciente ya existe en R2, listo para GOLD". Va a gold-queue, no de
// vuelta a marts-queue: marts-queue significa "hay un PROCESSED para
// construir marts", gold-queue significa "hay un MARTS para construir
// GOLD" - mismo criterio de una cola por transicion de capa que
// normalization-queue/marts-queue (ver wrangler.toml).
//
// `runKey` viaja en el mensaje a fines de logging/trazabilidad
// solamente - build-gold.ts (Patron Fan-In, igual que build-marts.ts) NO
// confia en este valor para decidir que leer: siempre vuelve a descubrir
// el runKey de MARTS mas reciente con storage.list() por su cuenta, para
// que un mensaje duplicado o fuera de orden (Cloudflare Queues entrega al
// menos una vez) nunca le haga reconstruir GOLD contra un runKey viejo.
export interface MartsProcessedReadyMessage {
  type: "MARTS_PROCESSED_READY";
  runKey: string;
  usedPartsMatchPath: string;
  ticketFieldBeatViewPath: string;
  ticketFieldBeatDolibarrViewPath: string;
}

export type GoldQueueMessage = MartsProcessedReadyMessage;
