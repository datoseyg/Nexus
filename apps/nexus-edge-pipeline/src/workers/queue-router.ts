// Router de colas - infraestructura, no logica de negocio: decide a quien
// le corresponde cada batch (`batch.queue`) y aplica la misma disciplina
// de ack/retry por mensaje a los tres. La logica real de cada mensaje vive
// en funciones separadas (processIngestionMessage/processNormalizationMessage)
// para que agregar una cuarta cola algun dia no signifique tocar el manejo
// de errores ya probado.
//
// CRITICO (ver Cloudflare Queues): un error sin capturar DENTRO de un
// `queue()` handler reintenta el LOTE ENTERO, no solo el mensaje que
// fallo. Por eso el try/catch siempre esta ADENTRO del for, nunca
// envolviendolo - cada mensaje se ack() o se retry() de forma
// independiente, y un mensaje roto no puede arrastrar a los demas del
// mismo batch a reprocesarse innecesariamente.

import type { GoldQueueMessage, IngestionQueueMessage, MartsQueueMessage, NormalizationQueueMessage } from "../lib/messages";
import { createStorageAdapter, type StorageEnv } from "../lib/storage";
import { processZendeskRaw } from "../use-cases/process-zendesk-raw";
import { processFieldBeatRaw } from "../use-cases/process-fieldbeat-raw";
import { processDolibarrRaw } from "../use-cases/process-dolibarr-raw";
import { buildMarts } from "../use-cases/build-marts";
import { buildGold } from "../use-cases/build-gold";

export interface QueueRouterEnv extends StorageEnv {
  // outputQueue de process-zendesk-raw.ts - ver messages.ts sobre por que
  // ZENDESK_PROCESSED_READY va a marts-queue y no de vuelta a
  // normalization-queue.
  MARTS_QUEUE: Queue<MartsQueueMessage>;
  // outputQueue de build-marts.ts - MARTS_PROCESSED_READY va a gold-queue,
  // no de vuelta a marts-queue (ver messages.ts).
  GOLD_QUEUE: Queue<GoldQueueMessage>;
  // Binding D1 que build-gold.ts materializa via D1Loader (ver
  // src/lib/d1-loader.ts) - el mismo WAREHOUSE que index.ts declara para
  // el resto del Worker.
  WAREHOUSE: D1Database;
}

export async function routeQueueBatch(
  batch: MessageBatch<unknown>,
  env: QueueRouterEnv,
  ctx: ExecutionContext
): Promise<void> {
  switch (batch.queue) {
    case "ingestion-queue":
      await drainBatch(batch as MessageBatch<IngestionQueueMessage>, processIngestionMessage, env);
      return;

    case "normalization-queue":
      await drainBatch(batch as MessageBatch<NormalizationQueueMessage>, processNormalizationMessage, env);
      return;

    case "marts-queue":
      // Fase 4 del blueprint (capa MARTS) - YA NO es esqueleto, ver
      // processMartsMessage() mas abajo.
      await drainBatch(batch as MessageBatch<MartsQueueMessage>, processMartsMessage, env);
      return;

    case "gold-queue":
      // Fase 5 del blueprint (capa GOLD) - YA NO es esqueleto, ver
      // processGoldMessage() mas abajo.
      await drainBatch(batch as MessageBatch<GoldQueueMessage>, processGoldMessage, env);
      return;

    default:
      // `batch.queue` nunca deberia traer un nombre que no este en
      // wrangler.toml - si pasa, es una señal de config desincronizada
      // entre el deploy del Worker y las colas reales de la cuenta.
      throw new Error(`Cola desconocida: "${batch.queue}"`);
  }
}

async function drainBatch<T>(
  batch: MessageBatch<T>,
  handler: (message: Message<T>, env: QueueRouterEnv) => Promise<void>,
  env: QueueRouterEnv
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handler(message, env);
      message.ack();
    } catch (error) {
      console.error(
        `[${batch.queue}] mensaje ${message.id} (intento ${message.attempts}) fallo:`,
        error instanceof Error ? error.message : error
      );
      message.retry();
    }
  }
}

// ---------------------------------------------------------------------
// processIngestionMessage sigue siendo un esqueleto (sin productores
// reales hacia ingestion-queue todavia, ver messages.ts). Existe por dos
// razones: (1) validar que el enrutamiento y el manejo de error/retry por
// mensaje funcionan de punta a punta antes de escribir logica de negocio
// encima, (2) dejar explicito el contrato que la Fase 3 tiene que cumplir
// acá: idempotente respecto al dato del mensaje, nunca asumir que un
// mensaje no fue procesado antes (Cloudflare Queues entrega al menos una
// vez - un mismo mensaje puede llegar duplicado).
//
// processNormalizationMessage YA NO es esqueleto: delega en el caso de
// uso de dominio (src/use-cases/process-zendesk-raw.ts) para
// ZENDESK_RAW_READY.
//
// processMartsMessage tambien delega en un caso de uso de dominio
// (src/use-cases/build-marts.ts), pero a diferencia de
// processNormalizationMessage NO hace un switch por `message.body.type`:
// los tres eventos de marts-queue (ZENDESK/FIELDBEAT/DOLIBARR_PROCESSED_READY)
// disparan exactamente la misma accion (Patron Fan-In, ver build-marts.ts)
// - build-marts.ts no le presta atencion a cual de los tres domino evento
// la desperto, siempre intenta reunir el PROCESSED mas reciente de los
// TRES dominios.
// ---------------------------------------------------------------------

async function processIngestionMessage(message: Message<IngestionQueueMessage>, _env: QueueRouterEnv): Promise<void> {
  console.log(`[ingestion-queue] mensaje ${message.id}, type=${message.body.type}`);
  // TODO Fase 3: disparo de ingesta bajo demanda (ej. reintento manual de
  // una fuente especifica) - no hay logica de negocio todavia.
}

// Decide por `message.body.type` - un caso de uso por dominio
// (Zendesk/FieldBeat/Dolibarr), los tres con la misma forma: instanciar
// el storage, delegar en el caso de uso pasandole `env.MARTS_QUEUE` como
// outputQueue, loguear. El switch exhaustivo (`never` en el default)
// obliga a agregar el case nuevo acá mismo el dia que se sume un cuarto
// dominio - no permite olvidarlo.
async function processNormalizationMessage(message: Message<NormalizationQueueMessage>, env: QueueRouterEnv): Promise<void> {
  const storage = createStorageAdapter(env);

  switch (message.body.type) {
    case "ZENDESK_RAW_READY": {
      const result = await processZendeskRaw(message.body.path, { storage, outputQueue: env.MARTS_QUEUE });
      console.log(`[normalization-queue] ${message.body.path} -> ${result.ticketsPath} (${result.ticketCount} tickets)`);
      return;
    }

    case "FIELDBEAT_RAW_READY": {
      const result = await processFieldBeatRaw(message.body.path, { storage, outputQueue: env.MARTS_QUEUE });
      console.log(`[normalization-queue] ${message.body.path} -> ${result.tasksPath} (${result.taskCount} tareas)`);
      return;
    }

    case "DOLIBARR_RAW_READY": {
      const result = await processDolibarrRaw(message.body.path, { storage, outputQueue: env.MARTS_QUEUE });
      console.log(`[normalization-queue] ${message.body.path} -> ${result.productsPath} (${result.productCount} productos)`);
      return;
    }

    default: {
      const exhaustiveCheck: never = message.body;
      throw new Error(`Tipo de mensaje desconocido en normalization-queue: "${JSON.stringify(exhaustiveCheck)}"`);
    }
  }
}

// A diferencia de processNormalizationMessage, acá NO hay switch por
// `message.body.type` - ver el comentario de arriba (Patron Fan-In): los
// tres eventos de marts-queue disparan la misma llamada a buildMarts().
// `message.body.type` solo se usa para el log, no para ramificar logica.
//
// `result.built === false` NO es un error: significa que todavia falta el
// PROCESSED de algun dominio (buildMarts() ya explica cual en
// `result.reason`). Se loguea y se hace return normal - el mensaje se
// ack() igual en drainBatch(), porque reintentar ESTE mismo mensaje no
// cambia nada; el proximo *_PROCESSED_READY real (del dominio faltante)
// es el que va a completar el build.
async function processMartsMessage(message: Message<MartsQueueMessage>, env: QueueRouterEnv): Promise<void> {
  const storage = createStorageAdapter(env);
  const result = await buildMarts({ storage, outputQueue: env.GOLD_QUEUE });

  if (!result.built) {
    console.log(`[marts-queue] mensaje ${message.id} (${message.body.type}): build abortado - ${result.reason}`);
    return;
  }

  console.log(
    `[marts-queue] mensaje ${message.id} (${message.body.type}): marts reconstruidos - ` +
      `${result.ticketCount} tickets, ${result.usedPartsCount} repuestos (${result.ticketFieldBeatDolibarrViewPath}).`
  );
}

// Igual que processMartsMessage: gold-queue solo tiene un tipo de mensaje
// hoy (MARTS_PROCESSED_READY), pero no hace falta un switch por
// `message.body.type` de todos modos - build-gold.ts es Fan-In puro
// (siempre redescubre el MARTS mas reciente por su cuenta, ver ese
// archivo), así que cualquier mensaje de esta cola dispara exactamente la
// misma accion.
async function processGoldMessage(message: Message<GoldQueueMessage>, env: QueueRouterEnv): Promise<void> {
  const storage = createStorageAdapter(env);
  const result = await buildGold({ storage, db: env.WAREHOUSE });

  if (!result.built) {
    console.log(`[gold-queue] mensaje ${message.id} (${message.body.type}): build abortado - ${result.reason}`);
    return;
  }

  const rowCounts = result.outputs?.map(o => `${o.table}=${o.rowCount}`).join(", ") ?? "";
  console.log(
    `[gold-queue] mensaje ${message.id} (${message.body.type}): gold reconstruido desde MARTS "${result.martsRunKey}" ` +
      `-> GOLD "${result.goldRunKey}" (${rowCounts}).`
  );
}
