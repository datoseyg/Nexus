// Mecanismo de actualización manual de datos (sql/101_pipeline_refresh_runs.sql)
// - pruebas de integración contra un Postgres real y DESECHABLE, mismo
// mecanismo de seguridad que test/audit/role-capabilities-unification.integration.test.ts.
// Usa el pool admin directo (igual que esa suite) para ejercitar las
// funciones SECURITY DEFINER y la concurrencia real; los tests de
// grants/roles verifican por separado que la superficie de ejecución esté
// correctamente separada por rol (Gate B: la autoridad real es el rol de
// conexión + GRANT, nunca solo la lógica de la función).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "pipeline-refresh-runs-test";

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

async function startRun(args: {
  environment: string;
  mode: string;
  executorType?: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  confirmed?: boolean;
  reason?: string | null;
  idempotencyKey?: string | null;
  correlationId?: string | null;
}): Promise<StartResult> {
  const r = await pool.query(
    `SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
    [
      args.environment,
      args.mode,
      args.executorType ?? "LOCAL",
      args.actorUserId ?? null,
      args.actorRole ?? "gerencia",
      args.confirmed ?? false,
      args.reason ?? null,
      args.idempotencyKey ?? null,
      args.correlationId ?? null
    ]
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

test("fn_start_refresh_run: mode=FULL sin confirmed=true rechaza con CONFIRMATION_REQUIRED y no crea fila", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(
    () => startRun({ environment: "LOCAL", mode: "FULL", confirmed: false }),
    /CONFIRMATION_REQUIRED/
  );
  const count = await pool.query(`SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'LOCAL' AND status = 'QUEUED'`);
  assert.equal(count.rows[0].n, "0");
});

test("fn_start_refresh_run: mode=FULL con confirmed=true crea una corrida QUEUED", { skip: !TEST_DB_URL }, async () => {
  const result = await startRun({ environment: "LOCAL", mode: "FULL", confirmed: true, reason: "prueba de integración" });
  assert.equal(result.status, "QUEUED");
  const row = await runRow(result.refreshRunId);
  assert.equal(row.mode, "FULL");
  assert.equal(row.trigger_type, "MANUAL");
  assert.deepEqual(row.sources_requested, ["fieldbeat", "zendesk", "dolibarr"]);
  await failRun(result.refreshRunId);
});

test("fn_start_refresh_run: dos llamadas concurrentes para el mismo entorno - exactamente una QUEUED, la otra ALREADY_RUNNING", { skip: !TEST_DB_URL }, async () => {
  const [a, b] = await Promise.all([
    startRun({ environment: "LOCAL", mode: "INCREMENTAL" }),
    startRun({ environment: "LOCAL", mode: "INCREMENTAL" })
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ["ALREADY_RUNNING", "QUEUED"]);
  assert.equal(a.refreshRunId, b.refreshRunId, "ALREADY_RUNNING debe apuntar a la misma fila que la que sí quedó QUEUED");

  const activeCount = await pool.query(`SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'LOCAL' AND status IN ('QUEUED','CLAIMED','RUNNING')`);
  assert.equal(activeCount.rows[0].n, "1", "la carrera nunca debe dejar más de una corrida activa por entorno");

  await failRun(a.refreshRunId);
});

test("fn_start_refresh_run: idempotency_key reintentado devuelve la misma fila (replay)", { skip: !TEST_DB_URL }, async () => {
  const first = await startRun({ environment: "LOCAL", mode: "INCREMENTAL", idempotencyKey: "TEST-IDEMPOTENCY-KEY-1" });
  assert.equal(first.status, "QUEUED");
  assert.notEqual(first.replay, true);

  const second = await startRun({ environment: "LOCAL", mode: "INCREMENTAL", idempotencyKey: "TEST-IDEMPOTENCY-KEY-1" });
  assert.equal(second.refreshRunId, first.refreshRunId);
  assert.equal(second.replay, true);

  await failRun(first.refreshRunId);
});

test("fn_start_refresh_run: reusar la misma idempotency_key con un body distinto rechaza (IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY)", { skip: !TEST_DB_URL }, async () => {
  const first = await startRun({ environment: "LOCAL", mode: "INCREMENTAL", idempotencyKey: "TEST-IDEMPOTENCY-KEY-2", reason: "primer intento" });
  assert.equal(first.status, "QUEUED");

  await assert.rejects(
    () => startRun({ environment: "LOCAL", mode: "INCREMENTAL", idempotencyKey: "TEST-IDEMPOTENCY-KEY-2", reason: "intento distinto - mismo idempotency_key" }),
    /IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY/
  );

  // La corrida original sigue intacta - el intento rechazado nunca la tocó
  // ni creó una segunda fila.
  const row = await runRow(first.refreshRunId);
  assert.equal(row.status, "QUEUED");
  const count = await pool.query(`SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'LOCAL' AND status IN ('QUEUED','CLAIMED','RUNNING')`);
  assert.equal(count.rows[0].n, "1");

  await failRun(first.refreshRunId);
});

test("índice único parcial: un INSERT manual de una segunda fila activa en el mismo entorno viola la constraint (23505)", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "LOCAL", mode: "INCREMENTAL" });
  await assert.rejects(
    () => pool.query(
      `INSERT INTO pipeline.refresh_runs (environment, mode, executor_type, status) VALUES ('LOCAL','INCREMENTAL','LOCAL','QUEUED')`
    ),
    (err: unknown) => (err as { code?: string }).code === "23505"
  );
  await failRun(started.refreshRunId);
});

test("fn_claim_next_refresh_run: dos claims concurrentes - exactamente uno reclama, el otro claimed:false", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun({ environment: "STAGING", mode: "INCREMENTAL", executorType: "LOCAL" });

  const [a, b] = await Promise.all([
    claimRun("STAGING", "LOCAL", "worker-a"),
    claimRun("STAGING", "LOCAL", "worker-b")
  ]);
  const claimed = [a, b].filter(r => r.claimed);
  const notClaimed = [a, b].filter(r => !r.claimed);
  assert.equal(claimed.length, 1, "exactamente un worker debe ganar el claim");
  assert.equal(notClaimed.length, 1);
  assert.equal(claimed[0].refreshRunId, started.refreshRunId);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "CLAIMED");
  assert.ok(row.claimed_by === "worker-a" || row.claimed_by === "worker-b");
  assert.ok(row.claimed_at);

  await failRun(started.refreshRunId);
});

test("fn_claim_next_refresh_run: sin corridas QUEUED devuelve claimed:false", { skip: !TEST_DB_URL }, async () => {
  const result = await claimRun("STAGING", "LOCAL", "worker-idle");
  assert.equal(result.claimed, false);
});

test("ciclo de vida completo (QUEUED -> CLAIMED -> RUNNING -> SUCCEEDED) publica el snapshot", { skip: !TEST_DB_URL }, async () => {
  const beforePublished = await pool.query(`SELECT published_data_generation, published_refresh_run_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`);

  const started = await startRun({ environment: "PRODUCTION", mode: "INCREMENTAL", executorType: "GITHUB" });
  const claim = await claimRun("PRODUCTION", "GITHUB", "gh-run-123");
  assert.equal(claim.claimed, true);

  await pool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [started.refreshRunId, "EXTRACT"]);
  await pool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [started.refreshRunId, "NORMALIZE"]);
  await pool.query(`SELECT pipeline.fn_heartbeat_refresh_run($1)`, [started.refreshRunId]);

  const mid = await runRow(started.refreshRunId);
  assert.equal(mid.status, "RUNNING");
  assert.equal(mid.current_stage, "NORMALIZE");
  assert.ok(mid.started_at);
  assert.ok(mid.last_heartbeat_at);

  const stagesBeforeComplete = await pool.query(`SELECT stage_name, status FROM pipeline.refresh_run_stages WHERE refresh_run_id = $1 ORDER BY stage_name`, [started.refreshRunId]);
  assert.deepEqual(stagesBeforeComplete.rows.map(r => [r.stage_name, r.status]), [["EXTRACT", "SUCCEEDED"], ["NORMALIZE", "RUNNING"]]);

  await pool.query(
    `SELECT pipeline.fn_complete_refresh_run($1,$2,$3,$4,$5,$6,$7,$8)`,
    [started.refreshRunId, ["fieldbeat", "zendesk", "dolibarr"], 100, 100, "PASSED", null, "TEST-SNAPSHOT-1", JSON.stringify({ testRun: true })]
  );

  const finished = await runRow(started.refreshRunId);
  assert.equal(finished.status, "SUCCEEDED");
  assert.ok(finished.finished_at);
  assert.deepEqual(finished.sources_completed, ["fieldbeat", "zendesk", "dolibarr"]);
  assert.equal(finished.validation_status, "PASSED");

  const stagesAfterComplete = await pool.query(`SELECT status FROM pipeline.refresh_run_stages WHERE refresh_run_id = $1`, [started.refreshRunId]);
  assert.ok(stagesAfterComplete.rows.every(r => r.status === "SUCCEEDED"), "todas las etapas deben quedar SUCCEEDED tras completar la corrida");

  const afterPublished = await pool.query(`SELECT published_data_generation, published_refresh_run_id, source_snapshot_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`);
  assert.equal(afterPublished.rows[0].published_refresh_run_id, started.refreshRunId);
  assert.equal(afterPublished.rows[0].source_snapshot_id, "TEST-SNAPSHOT-1");
  assert.equal(Number(afterPublished.rows[0].published_data_generation), Number(beforePublished.rows[0].published_data_generation) + 1);
});

test("una corrida fallida nunca reemplaza el snapshot ya publicado", { skip: !TEST_DB_URL }, async () => {
  const publishedBefore = await pool.query(`SELECT published_refresh_run_id, source_snapshot_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`);

  const started = await startRun({ environment: "PRODUCTION", mode: "INCREMENTAL", executorType: "GITHUB" });
  await claimRun("PRODUCTION", "GITHUB", "gh-run-456");
  await pool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [started.refreshRunId, "EXTRACT"]);
  await pool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [started.refreshRunId, "SOURCE_TIMEOUT", "Zendesk API timeout tras 30s", false]);

  const failed = await runRow(started.refreshRunId);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error_code, "SOURCE_TIMEOUT");
  assert.equal(failed.error_summary, "Zendesk API timeout tras 30s");

  const stageRow = await pool.query(`SELECT status FROM pipeline.refresh_run_stages WHERE refresh_run_id = $1 AND stage_name = 'EXTRACT'`, [started.refreshRunId]);
  assert.equal(stageRow.rows[0].status, "FAILED");

  const publishedAfter = await pool.query(`SELECT published_refresh_run_id, source_snapshot_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`);
  assert.deepEqual(publishedAfter.rows[0], publishedBefore.rows[0], "el snapshot publicado sano nunca debe cambiar por una corrida fallida");
});

test("separación de privilegios: nexus_pipeline_requester solo puede ejecutar fn_start_refresh_run, nunca fn_claim/fn_complete/fn_fail", { skip: !TEST_DB_URL }, async () => {
  const grants = await pool.query<{ routine_name: string; grantee: string }>(
    `SELECT r.routine_name, g.grantee
     FROM information_schema.routine_privileges g
     JOIN information_schema.routines r ON r.specific_name = g.specific_name AND r.specific_schema = g.specific_schema
     WHERE g.routine_schema = 'pipeline' AND g.privilege_type = 'EXECUTE'
       AND g.grantee IN ('nexus_pipeline_requester','nexus_pipeline_worker')`
  );

  const byGrantee: Record<string, Set<string>> = { nexus_pipeline_requester: new Set(), nexus_pipeline_worker: new Set() };
  for (const row of grants.rows) byGrantee[row.grantee]?.add(row.routine_name);

  assert.ok(byGrantee.nexus_pipeline_requester.has("fn_start_refresh_run"));
  for (const fn of ["fn_claim_next_refresh_run", "fn_update_refresh_run_stage", "fn_heartbeat_refresh_run", "fn_complete_refresh_run", "fn_fail_refresh_run"]) {
    assert.ok(!byGrantee.nexus_pipeline_requester.has(fn), `nexus_pipeline_requester no debe poder ejecutar ${fn}`);
  }

  assert.ok(!byGrantee.nexus_pipeline_worker.has("fn_start_refresh_run"), "nexus_pipeline_worker no debe poder crear corridas");
  for (const fn of ["fn_claim_next_refresh_run", "fn_update_refresh_run_stage", "fn_heartbeat_refresh_run", "fn_complete_refresh_run", "fn_fail_refresh_run"]) {
    assert.ok(byGrantee.nexus_pipeline_worker.has(fn), `nexus_pipeline_worker debe poder ejecutar ${fn}`);
  }
});

test("ambos roles pueden leer pipeline.refresh_runs/refresh_run_stages/published_dataset_state (observabilidad)", { skip: !TEST_DB_URL }, async () => {
  const grants = await pool.query<{ table_name: string; grantee: string; privilege_type: string }>(
    `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'pipeline' AND table_name IN ('refresh_runs','refresh_run_stages','published_dataset_state')
       AND grantee IN ('nexus_pipeline_requester','nexus_pipeline_worker') AND privilege_type = 'SELECT'`
  );
  for (const role of ["nexus_pipeline_requester", "nexus_pipeline_worker"]) {
    for (const table of ["refresh_runs", "refresh_run_stages", "published_dataset_state"]) {
      assert.ok(
        grants.rows.some(r => r.grantee === role && r.table_name === table),
        `${role} debe poder leer pipeline.${table}`
      );
    }
  }
});
