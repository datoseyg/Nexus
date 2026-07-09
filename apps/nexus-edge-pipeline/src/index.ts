// Composition root del Worker - unico archivo que lee `env` directamente y
// arma/inyecta las dependencias concretas (StorageAdapter) hacia la lógica
// de negocio (src/workers/*). No hay lógica de negocio acá a propósito:
// ver src/workers/*-miner.ts y src/workers/queue-router.ts.

import { createStorageAdapter, type StorageEnv } from "./lib/storage";
import { mineZendeskTickets, type ZendeskMinerEnv } from "./workers/zendesk-miner";
import { mineFieldBeatTasks, type FieldBeatMinerEnv } from "./workers/fieldbeat-miner";
import { mineDolibarrProducts, type DolibarrMinerEnv } from "./workers/dolibarr-miner";
import { routeQueueBatch } from "./workers/queue-router";
import type { GoldQueueMessage, IngestionQueueMessage, MartsQueueMessage } from "./lib/messages";

export interface Env extends StorageEnv, ZendeskMinerEnv, FieldBeatMinerEnv, DolibarrMinerEnv {
  WAREHOUSE: D1Database;
  INGESTION_QUEUE: Queue<IngestionQueueMessage>;
  MARTS_QUEUE: Queue<MartsQueueMessage>;
  // outputQueue de build-marts.ts (Fase 4->5, ver src/lib/messages.ts) -
  // MARTS_PROCESSED_READY viaja acá, consumido por build-gold.ts.
  GOLD_QUEUE: Queue<GoldQueueMessage>;
}

// Un Worker, tres Cron Triggers (ver `[triggers].crons` en wrangler.toml) -
// `controller.cron` dice cual de los tres disparo esta invocacion. Estas
// constantes son la UNICA fuente de verdad de ese mapeo del lado del
// codigo; wrangler.toml tiene que declarar exactamente estos mismos 3
// strings de cron. No hay forma de compartir esto entre el .toml y el .ts
// sin un paso de build - si se cambia un horario en wrangler.toml, hay que
// actualizarlo acá tambien (ver el `default` del switch de abajo, que
// revienta fuerte si se desincronizan en vez de fallar en silencio).
const ZENDESK_CRON = "0 6 * * *";
const FIELDBEAT_CRON = "10 6 * * *";
const DOLIBARR_CRON = "20 6 * * *";

// Envuelve una corrida de miner con el mismo logueo/propagacion de error
// para los tres dominios - evita repetir el .then/.catch tres veces. El
// error SIEMPRE se relanza (nunca se traga): un cron que falla en
// silencio es peor que uno que no corre, y queda marcado como fallido en
// Workers Logs/observability.
function runMinerAndLog(label: string, run: Promise<unknown>): Promise<void> {
  return run
    .then(result => console.log(`${label}:`, result))
    .catch(error => {
      console.error(`${label} fallo:`, error);
      throw error;
    });
}

export default {
  // Health check de Fase 1 (validacion de wiring con R2) - se mantiene
  // porque sigue siendo util para monitoreo, no compite con nada nuevo.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/health") {
      return new Response("nexus-edge-pipeline: sin rutas de negocio via HTTP.", { status: 501 });
    }

    const storage = createStorageAdapter(env);
    await storage.put("_health/ping.json", JSON.stringify({ ok: true, at: new Date().toISOString() }), "application/json");
    return Response.json({ status: "ok", phase: "3B - asimilacion lateral (FieldBeat/Dolibarr)" });
  },

  // `controller.scheduledTime` es el timestamp fijo del tick, no
  // `Date.now()` - ver el comentario de idempotencia en cada *-miner.ts
  // sobre por qué importa esa distinción. Los tres cron triggers estan
  // deliberadamente separados por 10 minutos (ver wrangler.toml) para que
  // las tres ingestas no compitan por CPU ni golpeen tres APIs externas
  // distintas en el mismo instante.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const storage = createStorageAdapter(env);
    const scheduledAt = new Date(controller.scheduledTime);

    switch (controller.cron) {
      case ZENDESK_CRON:
        ctx.waitUntil(runMinerAndLog("Zendesk", mineZendeskTickets(env, storage, scheduledAt)));
        return;

      case FIELDBEAT_CRON:
        ctx.waitUntil(runMinerAndLog("FieldBeat", mineFieldBeatTasks(env, storage, scheduledAt)));
        return;

      case DOLIBARR_CRON:
        ctx.waitUntil(runMinerAndLog("Dolibarr", mineDolibarrProducts(env, storage, scheduledAt)));
        return;

      default:
        // No hay `never` que reclamar acá (los crons son strings sueltos,
        // no una union cerrada) - por eso se lanza explicito en vez de
        // solo loguear: un cron desconocido significa que wrangler.toml y
        // este archivo se desincronizaron.
        throw new Error(`Cron desconocido: "${controller.cron}" - no coincide con ningun trigger esperado en index.ts.`);
    }
  },

  // Un unico Worker consume las tres colas (ver wrangler.toml) -
  // routeQueueBatch decide por `batch.queue` a quien le corresponde cada
  // lote. Ver src/workers/queue-router.ts para el manejo de error/retry
  // por mensaje.
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    await routeQueueBatch(batch, env, ctx);
  }
} satisfies ExportedHandler<Env>;
