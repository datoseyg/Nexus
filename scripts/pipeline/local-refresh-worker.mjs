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
//   node scripts/pipeline/local-refresh-worker.mjs
//   node scripts/pipeline/local-refresh-worker.mjs --poll-interval-ms=5000
//   node scripts/pipeline/local-refresh-worker.mjs --once   (una sola pasada, sin loop - para pruebas)
import "dotenv/config";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isSupabaseCloudHost, describeConnectionTarget } from "../../src/lib/db-safety.js";
import { claimNextRefreshRunOnPool, executeClaimedRefreshRun } from "./run-data-refresh.mjs";

const ENVIRONMENT = "LOCAL";
const EXECUTOR_TYPE = "LOCAL";
const DEFAULT_POLL_INTERVAL_MS = 5000;

function parseArgs(argv) {
  const pollIntervalMs = Number(argv.find(a => a.startsWith("--poll-interval-ms="))?.slice("--poll-interval-ms=".length)) || DEFAULT_POLL_INTERVAL_MS;
  const once = argv.includes("--once");
  return { pollIntervalMs, once };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno.`);
  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { pollIntervalMs, once } = parseArgs(process.argv.slice(2));

  const governanceWorkerDbUrl = requireEnv("GOVERNANCE_PIPELINE_WORKER_DB_URL");
  const governanceRuleEvaluatorDbUrl = requireEnv("GOVERNANCE_RULE_EVALUATOR_DB_URL");
  const supabaseDbUrlDirect = requireEnv("SUPABASE_DB_URL_DIRECT");

  const target = describeConnectionTarget(supabaseDbUrlDirect);
  if (isSupabaseCloudHost(target.host)) {
    throw new Error(
      `ABORT: el worker LOCAL nunca debe apuntar a un host Supabase cloud (SUPABASE_DB_URL_DIRECT="${target.host}") - ` +
      "STAGING/PRODUCTION solo se procesan vía GitHub Actions (.github/workflows/data-refresh.yml)."
    );
  }

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
