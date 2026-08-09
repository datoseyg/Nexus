// Recuperación gobernada de corridas de refresh abandonadas
// (sql/102_pipeline_refresh_run_recovery.sql) - pruebas de integración
// contra un Postgres real y DESECHABLE, mismo mecanismo que
// test/pipeline/refresh-runs.integration.test.ts (archivo hermano, que ya
// cubre el ciclo de vida normal y sql/101). Este archivo cubre SOLO las dos
// funciones nuevas: fn_cancel_queued_refresh_run (cancelación humana
// explícita de QUEUED) y fn_reap_stale_refresh_runs (reap automático de
// CLAIMED/RUNNING sin heartbeat reciente).
//
// run-integration-tests.mjs corre cada archivo *.integration.test.ts como un
// `node --test` separado, en secuencia - así que este archivo puede asumir
// que ningún otro archivo está usando LOCAL/STAGING/PRODUCTION al mismo
// tiempo. DENTRO de este archivo, cada test deja su(s) corrida(s) en un
// estado terminal (o el entorno libre) antes de terminar, para que el
// siguiente test pueda reusar el mismo entorno sin chocar con el índice
// único parcial de "una corrida activa por entorno" (sql/101).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "pipeline-refresh-run-recovery-test";

const { Pool } = pg;
let pool: pg.Pool;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  pool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(pool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
});

afterAll(async () => {
  if (pool) await pool.end();
});

interface StartResult { refreshRunId: string; status: string; replay?: boolean }
interface ClaimResult { claimed: boolean; refreshRunId?: string; mode?: string; environment?: string }
interface ReapedEntry { refreshRunId: string; environment: string }

async function startRun(args: { environment: string; mode: string; executorType?: string; confirmed?: boolean; reason?: string | null }): Promise<StartResult> {
  const r = await pool.query(
    `SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
    [args.environment, args.mode, args.executorType ?? "LOCAL", null, "gerencia", args.confirmed ?? false, args.reason ?? null, null, null]
  );
  return r.rows[0].result as StartResult;
}

async function claimRun(environment: string, executorType: string, claimedBy: string): Promise<ClaimResult> {
  const r = await pool.query(`SELECT pipeline.fn_claim_next_refresh_run($1,$2,$3) AS result`, [environment, executorType, claimedBy]);
  return r.rows[0].result as ClaimResult;
}

async function runRow(refreshRunId: string) {
  const r = await pool.query(`SELECT * FROM pipeline.refresh_runs WHERE refresh_run_id = $1`, [refreshRunId]);
  return r.rows[0];
}

async function failRun(refreshRunId: string, partial = false) {
  await pool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [refreshRunId, "TEST_CLEANUP", "cierre de prueba", partial]);
}

async function cancelRun(refreshRunId: string, reason: string | null): Promise<{ refreshRunId: string; status: string }> {
  const r = await pool.query(`SELECT pipeline.fn_cancel_queued_refresh_run($1,$2,$3,$4) AS result`, [refreshRunId, null, "gerencia", reason]);
  return r.rows[0].result;
}

async function reapStale(intervalLiteral: string, environment: string | null = null): Promise<ReapedEntry[]> {
  const r = await pool.query(`SELECT pipeline.fn_reap_stale_refresh_runs($1::interval, $2) AS result`, [intervalLiteral, environment]);
  return r.rows[0].result as ReapedEntry[];
}

// ---------------------------------------------------------------------------
// fn_cancel_queued_refresh_run
// ---------------------------------------------------------------------------

test("fn_cancel_queued_refresh_run: cancela una corrida QUEUED con reason -> CANCELLED y libera el entorno", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "LOCAL", mode: "INCREMENTAL" });
  const result = await cancelRun(started.refreshRunId, "worker local nunca arrancó");
  assert.equal(result.status, "CANCELLED");
  assert.equal(result.refreshRunId, started.refreshRunId);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.error_code, "CANCELLED_BY_REQUEST");
  assert.match(row.error_summary, /worker local nunca arrancó/);
  assert.ok(row.finished_at);

  // El entorno queda libre - una corrida nueva en LOCAL debe poder encolarse.
  const again = await startRun({ environment: "LOCAL", mode: "INCREMENTAL" });
  assert.equal(again.status, "QUEUED");
  await failRun(again.refreshRunId);
});

test("fn_cancel_queued_refresh_run: reason vacío o solo espacios rechaza REASON_REQUIRED, no modifica la fila", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "STAGING", mode: "INCREMENTAL" });

  await assert.rejects(() => cancelRun(started.refreshRunId, null), /REASON_REQUIRED/);
  await assert.rejects(() => cancelRun(started.refreshRunId, "   "), /REASON_REQUIRED/);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "QUEUED", "un intento de cancelación rechazado nunca debe tocar la fila");

  await cancelRun(started.refreshRunId, "cierre de prueba");
});

test("fn_cancel_queued_refresh_run: refresh_run_id inexistente rechaza NOT_FOUND", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => cancelRun(randomUUID(), "motivo cualquiera"), /NOT_FOUND/);
});

test("fn_cancel_queued_refresh_run: una corrida CLAIMED no se puede cancelar (VALIDATION_ERROR)", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "PRODUCTION", mode: "INCREMENTAL", executorType: "LOCAL" });
  const claim = await claimRun("PRODUCTION", "LOCAL", "worker-a");
  assert.equal(claim.claimed, true);

  await assert.rejects(() => cancelRun(started.refreshRunId, "intento inválido"), /VALIDATION_ERROR/);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "CLAIMED", "un intento de cancelar una corrida ya reclamada nunca debe tocarla");

  await failRun(started.refreshRunId);
});

test("separación de privilegios: nexus_pipeline_requester puede cancelar; nexus_pipeline_worker no. Ambos pueden reapear.", { skip: !TEST_DB_URL }, async () => {
  const grants = await pool.query<{ routine_name: string; grantee: string }>(
    `SELECT r.routine_name, g.grantee
     FROM information_schema.routine_privileges g
     JOIN information_schema.routines r ON r.specific_name = g.specific_name AND r.specific_schema = g.specific_schema
     WHERE g.routine_schema = 'pipeline' AND g.privilege_type = 'EXECUTE'
       AND g.grantee IN ('nexus_pipeline_requester','nexus_pipeline_worker')
       AND r.routine_name IN ('fn_cancel_queued_refresh_run','fn_reap_stale_refresh_runs')`
  );
  const byGrantee: Record<string, Set<string>> = { nexus_pipeline_requester: new Set(), nexus_pipeline_worker: new Set() };
  for (const row of grants.rows) byGrantee[row.grantee]?.add(row.routine_name);

  assert.ok(byGrantee.nexus_pipeline_requester.has("fn_cancel_queued_refresh_run"));
  assert.ok(!byGrantee.nexus_pipeline_worker.has("fn_cancel_queued_refresh_run"), "el worker nunca debe poder cancelar una corrida - solo el humano vía la API");

  assert.ok(byGrantee.nexus_pipeline_requester.has("fn_reap_stale_refresh_runs"));
  assert.ok(byGrantee.nexus_pipeline_worker.has("fn_reap_stale_refresh_runs"));
});

// ---------------------------------------------------------------------------
// fn_reap_stale_refresh_runs
// ---------------------------------------------------------------------------

test("fn_reap_stale_refresh_runs: CLAIMED sin heartbeat reciente -> PARTIAL_FAILED, libera el entorno", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "LOCAL", mode: "INCREMENTAL", executorType: "LOCAL" });
  await claimRun("LOCAL", "LOCAL", "worker-a");

  const reaped = await reapStale("0 seconds", "LOCAL");
  assert.deepEqual(reaped, [{ refreshRunId: started.refreshRunId, environment: "LOCAL" }]);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "PARTIAL_FAILED");
  assert.equal(row.error_code, "REAPED_STALE_HEARTBEAT");
  assert.ok(row.finished_at);

  const again = await startRun({ environment: "LOCAL", mode: "INCREMENTAL" });
  assert.equal(again.status, "QUEUED", "el entorno debe quedar libre tras el reap");
  await failRun(again.refreshRunId);
});

test("fn_reap_stale_refresh_runs: heartbeat reciente bajo un intervalo amplio -> no se toca", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "STAGING", mode: "INCREMENTAL", executorType: "LOCAL" });
  await claimRun("STAGING", "LOCAL", "worker-a");

  const reaped = await reapStale("1 hour", "STAGING");
  assert.deepEqual(reaped, []);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "CLAIMED", "un heartbeat reciente nunca debe ser reapeado");

  await failRun(started.refreshRunId);
});

test("fn_reap_stale_refresh_runs: una corrida QUEUED nunca se reapea (solo CLAIMED/RUNNING)", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "PRODUCTION", mode: "INCREMENTAL" });

  const reaped = await reapStale("0 seconds", "PRODUCTION");
  assert.deepEqual(reaped, []);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "QUEUED", "QUEUED sin worker es ambiguo - nunca se resuelve solo, requiere fn_cancel_queued_refresh_run");

  await cancelRun(started.refreshRunId, "cierre de prueba");
});

test("fn_reap_stale_refresh_runs: marca FAILED la etapa RUNNING de la corrida reapeada", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "LOCAL", mode: "INCREMENTAL", executorType: "LOCAL" });
  await claimRun("LOCAL", "LOCAL", "worker-a");
  await pool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [started.refreshRunId, "EXTRACT"]);

  await reapStale("0 seconds", "LOCAL");

  const stageRow = await pool.query(
    `SELECT status, error_message FROM pipeline.refresh_run_stages WHERE refresh_run_id = $1 AND stage_name = 'EXTRACT'`,
    [started.refreshRunId]
  );
  assert.equal(stageRow.rows[0].status, "FAILED");
  assert.match(stageRow.rows[0].error_message, /Reap automático/);
});

test("fn_reap_stale_refresh_runs: p_environment acota el reap - no toca corridas stale de otros entornos", { skip: !TEST_DB_URL }, async () => {
  const staging = await startRun({ environment: "STAGING", mode: "INCREMENTAL", executorType: "LOCAL" });
  await claimRun("STAGING", "LOCAL", "worker-a");
  const production = await startRun({ environment: "PRODUCTION", mode: "INCREMENTAL", executorType: "LOCAL" });
  await claimRun("PRODUCTION", "LOCAL", "worker-b");

  const reaped = await reapStale("0 seconds", "STAGING");
  assert.deepEqual(reaped, [{ refreshRunId: staging.refreshRunId, environment: "STAGING" }]);

  const productionRow = await runRow(production.refreshRunId);
  assert.equal(productionRow.status, "CLAIMED", "acotar por entorno nunca debe tocar corridas stale de otro entorno");

  await failRun(production.refreshRunId);
});

test("fn_reap_stale_refresh_runs: sin p_environment reapea cualquier entorno; idempotente si no queda nada que reparar", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "LOCAL", mode: "INCREMENTAL", executorType: "LOCAL" });
  await claimRun("LOCAL", "LOCAL", "worker-a");

  const firstPass = await reapStale("0 seconds", null);
  assert.ok(firstPass.some(r => r.refreshRunId === started.refreshRunId && r.environment === "LOCAL"));

  const secondPass = await reapStale("0 seconds", null);
  assert.deepEqual(secondPass, [], "una segunda pasada sin nada stale debe devolver un array vacío, nunca volver a tocar filas ya terminales");
});
