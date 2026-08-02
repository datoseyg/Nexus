#!/usr/bin/env node
// NEXUS V3 - Worker local del refresh de datos (requisito 2 del encargo:
// "debe funcionar igual en local y en GitHub Actions, un solo orquestador").
// Loop que reclama la próxima corrida QUEUED para environment=LOCAL vía
// pipeline.fn_claim_next_refresh_run y la ejecuta con el MISMO orquestador
// que usa el job de GitHub Actions (scripts/pipeline/run-data-refresh.mjs) -
// este archivo es solo el bucle de polling + manejo de señales, nunca
// reimplementa ninguna etapa del pipeline.
//
// Solo corre contra Postgres local, nunca contra nada desplegado: además
// del guard V2/V3 dentro del orquestador (assertKnownSupabaseProject en la
// etapa SYNC_POSTGRES), este worker rechaza arrancar si SUPABASE_DB_URL_DIRECT
// apunta a un host Supabase cloud - la separación LOCAL/STAGING/PRODUCTION
// es por "environment" en pipeline.refresh_runs, pero el WORKER que corre en
// esta máquina de desarrollo nunca debe poder procesar una corrida STAGING/
// PRODUCTION (esas solo las procesa GitHub Actions, con sus propios
// secretos) - por eso valida también --environment=LOCAL como único valor
// aceptado acá.
//
// Uso:
//   npm run pipeline:refresh:worker:local            (recomendado - carga env vía with-local-pipeline-env.mjs)
//   npm run pipeline:refresh:worker:local -- --once   (una sola pasada, sin loop - para pruebas)
//
// Este archivo NUNCA carga dotenv por su cuenta (a propósito - antes tenía
// un `import "dotenv/config"` acá, que cargaba en silencio el .env de la
// raíz del repo -con un SUPABASE_DB_URL_DIRECT de Supabase CLOUD, para
// migrate-to-supabase.js- cada vez que a este proceso le faltaba esa
// variable. Eso enmascaraba justo la validación que exige el requisito 1:
// "reportar TODAS las variables faltantes juntas" nunca detectaba
// SUPABASE_DB_URL_DIRECT como faltante, porque dotenv ya la había rellenado
// por detrás con un valor que además apuntaba a un host equivocado -
// detectado por un test de integración real, ver
// test/pipeline/local-refresh-worker.integration.test.ts). Este proceso
// exige que su entorno ya venga completo desde quien lo invoca -
// npm run pipeline:refresh:worker:local, vía with-local-pipeline-env.mjs- y
// solo valida con requireAllEnv, nunca rellena nada por su cuenta.
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isSupabaseCloudHost, describeConnectionTarget } from "../../src/lib/db-safety.js";
// NUNCA "import ... from './run-data-refresh.mjs'" estático acá (a
// propósito): ese archivo importa, a su vez, los 3 miners +
// migrate-to-supabase.js + validate-supabase.js + working-hours/db-client.js
// - CADA UNO con su propio `import "dotenv/config"` (para cuando se corren
// como CLI standalone). Un import ESTÁTICO se ejecuta ANTES que cualquier
// código propio de este archivo, incluida requireAllEnv() de más abajo - así
// que remover el dotenv/config de ESTE archivo y del propio
// run-data-refresh.mjs (ambos ya limpios) no alcanzaba: la cascada de
// imports de run-data-refresh.mjs igual disparaba esos OTROS dotenv/config
// antes de que requireAllEnv pudiera correr, rellenando en silencio
// SUPABASE_DB_URL_DIRECT con el valor de Supabase Cloud del .env de la raíz
// (detectado con un test de integración real - ver
// test/pipeline/local-refresh-worker.integration.test.ts). La solución real
// es un import DINÁMICO (await import(...) dentro de main(), después de
// requireAllEnv) - así ninguna de esas cascadas de dotenv se dispara hasta
// que ya se confirmó que el entorno viene completo.

const ENVIRONMENT = "LOCAL";
const EXECUTOR_TYPE = "LOCAL";
const DEFAULT_POLL_INTERVAL_MS = 5000;

function parseArgs(argv) {
  const pollIntervalMs = Number(argv.find(a => a.startsWith("--poll-interval-ms="))?.slice("--poll-interval-ms=".length)) || DEFAULT_POLL_INTERVAL_MS;
  const once = argv.includes("--once");
  return { pollIntervalMs, once };
}

const REQUIRED_ENV_VARS = ["GOVERNANCE_PIPELINE_WORKER_DB_URL", "GOVERNANCE_RULE_EVALUATOR_DB_URL", "SUPABASE_DB_URL_DIRECT"];

// Junta TODAS las variables faltantes en un solo error (nunca una por vez -
// un desarrollador que corrige la primera y vuelve a correr solo para
// toparse con la siguiente pierde tiempo real). Nunca imprime valores ni
// contraseñas, solo los NOMBRES de las variables ausentes.
function requireAllEnv(names) {
  const missing = names.filter(name => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan ${missing.length} variable(s) de entorno: ${missing.join(", ")}. ` +
      "Correr este worker vía `npm run pipeline:refresh:worker:local` desde la raíz del repo " +
      "(usa scripts/with-local-pipeline-env.mjs, que carga .env + .env.working-hours.local + " +
      "apps/nexus-bi-app/.env.development.local en el orden correcto) - nunca invocar " +
      "scripts/pipeline/local-refresh-worker.mjs directo sin ese wrapper."
    );
  }
  return Object.fromEntries(names.map(name => [name, process.env[name]]));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Autocuración de corridas abandonadas (sql/102_pipeline_refresh_run_recovery.sql)
// - corre ANTES de cada intento de reclamar trabajo nuevo, mismo criterio
// documentado en el encabezado de esa migración. Acotado a p_environment='LOCAL'
// a propósito: este worker nunca debe tocar corridas STAGING/PRODUCTION (mismo
// límite que ya aplica el guard de SUPABASE_DB_URL_DIRECT más arriba) - esas
// las procesa GitHub Actions dentro de su propio job, sin un worker persistente
// que necesite este auto-reap. El intervalo de staleness usa el default de la
// función (5 minutos) - más del doble del heartbeat de 15s del orquestador
// (run-data-refresh.mjs::HEARTBEAT_INTERVAL_MS), así nunca reapea una corrida
// sana que solo tuvo una pausa momentánea entre heartbeats.
async function reapStaleLocalRuns(pool) {
  try {
    const r = await pool.query(`SELECT pipeline.fn_reap_stale_refresh_runs(p_environment => $1) AS result`, [ENVIRONMENT]);
    const reaped = r.rows[0].result ?? [];
    for (const entry of reaped) {
      console.warn(`[local-refresh-worker] reap: refresh_run_id=${entry.refreshRunId} (environment=${entry.environment}) sin heartbeat reciente - marcada PARTIAL_FAILED, entorno liberado.`);
    }
  } catch (error) {
    console.error(`[local-refresh-worker] error al reapear corridas abandonadas: ${error.message}`);
  }
}

async function main() {
  const { pollIntervalMs, once } = parseArgs(process.argv.slice(2));

  const env = requireAllEnv(REQUIRED_ENV_VARS);
  const governanceWorkerDbUrl = env.GOVERNANCE_PIPELINE_WORKER_DB_URL;
  const governanceRuleEvaluatorDbUrl = env.GOVERNANCE_RULE_EVALUATOR_DB_URL;
  const supabaseDbUrlDirect = env.SUPABASE_DB_URL_DIRECT;

  const target = describeConnectionTarget(supabaseDbUrlDirect);
  if (isSupabaseCloudHost(target.host)) {
    throw new Error(
      `ABORT: el worker LOCAL nunca debe apuntar a un host Supabase cloud (SUPABASE_DB_URL_DIRECT="${target.host}") - ` +
      "STAGING/PRODUCTION solo se procesan vía GitHub Actions (.github/workflows/data-refresh.yml)."
    );
  }

  // Import diferido a propósito - ver el comentario junto a los imports de
  // más arriba. Recién acá, con el entorno ya validado completo y seguro
  // (nunca Supabase cloud), se dispara la cascada de imports del
  // orquestador real (miners, migrate-to-supabase, working-hours, etc.).
  const { claimNextRefreshRunOnPool, executeClaimedRefreshRun } = await import("./run-data-refresh.mjs");

  const workerId = `local-worker:${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  console.log(`[local-refresh-worker] iniciado worker_id=${workerId} poll_interval_ms=${pollIntervalMs}`);

  let shuttingDown = false;
  function requestShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[local-refresh-worker] señal ${signal} recibida - terminando tras la corrida actual (si hay una en curso), no se deja ninguna corrida colgada en RUNNING sin intentar cerrarla).`);
  }
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  // Un solo Pool para toda la vida del proceso - el loop de abajo puede
  // reclamar cada `pollIntervalMs` (default 5s) potencialmente por horas;
  // abrir+cerrar una conexión nueva en cada tick sería un handshake de
  // Postgres desperdiciado en cada intento sin trabajo (el caso normal,
  // estado ocioso). Mismo criterio que el pool cacheado de
  // apps/nexus-bi-app/lib/governance-db.ts::getGovernancePool.
  const pool = new pg.Pool({ connectionString: governanceWorkerDbUrl, application_name: "pipeline-refresh-worker:poll", max: 2 });

  try {
    do {
      await reapStaleLocalRuns(pool);

      let claim;
      try {
        claim = await claimNextRefreshRunOnPool(pool, { environment: ENVIRONMENT, executorType: EXECUTOR_TYPE, workerId });
      } catch (error) {
        console.error(`[local-refresh-worker] error al reclamar: ${error.message}`);
        claim = { claimed: false };
      }

      if (claim.claimed) {
        console.log(`[local-refresh-worker] procesando refresh_run_id=${claim.refreshRunId}`);
        try {
          await executeClaimedRefreshRun({
            refreshRunId: claim.refreshRunId,
            environment: ENVIRONMENT,
            governanceWorkerDbUrl,
            governanceRuleEvaluatorDbUrl,
            supabaseDbUrlDirect
          });
        } catch (error) {
          // executeClaimedRefreshRun ya llamó pipeline.fn_fail_refresh_run
          // internamente - acá solo se registra para no tumbar el loop.
          console.error(`[local-refresh-worker] refresh_run_id=${claim.refreshRunId} terminó con error: ${error.message}`);
        }
      } else if (once) {
        console.log("[local-refresh-worker] --once: nada QUEUED, sin trabajo. Saliendo.");
        return;
      } else {
        await sleep(pollIntervalMs);
      }
    } while (!once && !shuttingDown);
  } finally {
    await pool.end();
  }

  console.log("[local-refresh-worker] detenido.");
}

main().catch(error => {
  console.error("[local-refresh-worker] ERROR FATAL:", error.message);
  process.exit(1);
});
