// NEXUS V3 - pipeline.fn_claim_refresh_run_by_id (sql/110), blocker de
// revisión de producto: "correlación debe reclamar por ID, no
// claim-next-then-check". Integración real contra Postgres desechable,
// mismo mecanismo que test/pipeline/refresh-runs.integration.test.ts (pool
// admin directo, SECURITY DEFINER real, concurrencia real vía dos consultas
// en paralelo sobre el mismo pool).
//
// Cubre específicamente lo que fn_claim_next_refresh_run + comparación
// posterior (el mecanismo viejo) NO podía garantizar: que reclamar por
// refresh_run_id exacto es estructuralmente incapaz de tocar cualquier otra
// fila - nunca solo "detecta" el mismatch después del hecho.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "pipeline-claim-refresh-run-by-id-test";

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

interface StartResult { refreshRunId: string; status: string }
interface ClaimByIdResult { claimed: boolean; refreshRunId?: string; mode?: string; environment?: string; reason?: string; status?: string }

async function startRun(environment: string, executorType = "GITHUB"): Promise<StartResult> {
  const r = await pool.query(
    `SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
    [environment, "INCREMENTAL", executorType, null, "administracion", false, null, null, null]
  );
  return r.rows[0].result as StartResult;
}

async function claimById(refreshRunId: string, environment: string, executorType: string, claimedBy: string): Promise<ClaimByIdResult> {
  const r = await pool.query(
    `SELECT pipeline.fn_claim_refresh_run_by_id($1,$2,$3,$4) AS result`,
    [refreshRunId, environment, executorType, claimedBy]
  );
  return r.rows[0].result as ClaimByIdResult;
}

async function runRow(refreshRunId: string) {
  const r = await pool.query(`SELECT * FROM pipeline.refresh_runs WHERE refresh_run_id = $1`, [refreshRunId]);
  return r.rows[0];
}

async function failRun(refreshRunId: string) {
  await pool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [refreshRunId, "TEST_CLEANUP", "cierre de prueba", false]);
}

test("fn_claim_refresh_run_by_id: QUEUED + environment/executor correctos -> claimed:true, fila pasa a CLAIMED con fencing (claimed_by/claimed_at/last_heartbeat_at)", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");
  const claim = await claimById(started.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-123:1");
  assert.equal(claim.claimed, true);
  assert.equal(claim.refreshRunId, started.refreshRunId);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "CLAIMED");
  assert.equal(row.claimed_by, "gh-run-123:1");
  assert.ok(row.claimed_at);
  assert.ok(row.last_heartbeat_at);

  await failRun(started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: environment equivocado -> claimed:false (ENVIRONMENT_MISMATCH), la fila QUEUED queda intacta", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");
  const claim = await claimById(started.refreshRunId, "STAGING", "GITHUB", "gh-run-wrong-env");
  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, "ENVIRONMENT_MISMATCH");

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "QUEUED", "un mismatch de environment nunca debe reclamar ni tocar la fila");
  assert.equal(row.claimed_by, null);

  await failRun(started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: executor_type equivocado -> claimed:false (EXECUTOR_TYPE_MISMATCH), la fila QUEUED queda intacta", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");
  const claim = await claimById(started.refreshRunId, "PRODUCTION", "LOCAL", "worker-wrong-executor");
  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, "EXECUTOR_TYPE_MISMATCH");

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "QUEUED");
  assert.equal(row.claimed_by, null);

  await failRun(started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: refresh_run_id inexistente -> claimed:false, nunca lanza, nunca toca ninguna fila", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");
  const bogusId = "00000000-0000-0000-0000-000000000000";
  const claim = await claimById(bogusId, "PRODUCTION", "GITHUB", "gh-run-bogus");
  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, "NOT_FOUND_OR_LOCKED");

  // La corrida REAL (distinta del id inexistente pedido) nunca se tocó -
  // exactamente el requisito "si hay otra QUEUED, jamás es reclamada/fallada
  // por mismatch".
  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "QUEUED");

  await failRun(started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: fila ya CLAIMED (no QUEUED) -> claimed:false (NOT_QUEUED), no la vuelve a tocar ni cambia claimed_by", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");
  const first = await claimById(started.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-first-owner");
  assert.equal(first.claimed, true);

  const second = await claimById(started.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-second-owner");
  assert.equal(second.claimed, false);
  assert.equal(second.reason, "NOT_QUEUED");
  assert.equal(second.status, "CLAIMED");

  const row = await runRow(started.refreshRunId);
  assert.equal(row.claimed_by, "gh-run-first-owner", "un segundo intento sobre una fila ya CLAIMED nunca debe pisar al dueño real");

  await failRun(started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: una fila QUEUED distinta en OTRO entorno nunca se toca al reclamar por un id que no es el suyo (nunca cae a 'lo próximo en cola')", { skip: !TEST_DB_URL }, async () => {
  const other = await startRun("STAGING", "GITHUB");
  const target = await startRun("PRODUCTION", "GITHUB");

  // Pide reclamar `target` en el entorno equivocado (STAGING) - a
  // diferencia de fn_claim_next_refresh_run, esta función NUNCA "cae" a
  // reclamar la corrida real de STAGING (`other`) en su lugar: el único
  // WHERE de la función es por refresh_run_id exacto.
  const claim = await claimById(target.refreshRunId, "STAGING", "GITHUB", "gh-run-cross-environment");
  assert.equal(claim.claimed, false);

  const otherRow = await runRow(other.refreshRunId);
  assert.equal(otherRow.status, "QUEUED", "la corrida real de STAGING nunca debe reclamarse como efecto secundario de pedir otro id");
  assert.equal(otherRow.claimed_by, null);

  await failRun(other.refreshRunId);
  await failRun(target.refreshRunId);
});

test("fn_claim_refresh_run_by_id: dos reclamos concurrentes para el MISMO refresh_run_id -> exactamente uno reclama, el otro sale limpio, ninguna otra fila se toca", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");

  const [a, b] = await Promise.all([
    claimById(started.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-race-a"),
    claimById(started.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-race-b")
  ]);
  const claimed = [a, b].filter(r => r.claimed);
  const notClaimed = [a, b].filter(r => !r.claimed);
  assert.equal(claimed.length, 1, "exactamente uno de los dos workflow_dispatch para el mismo refresh_run_id debe ganar el claim");
  assert.equal(notClaimed.length, 1);
  assert.equal(claimed[0].refreshRunId, started.refreshRunId);

  const row = await runRow(started.refreshRunId);
  assert.equal(row.status, "CLAIMED");
  assert.ok(row.claimed_by === "gh-run-race-a" || row.claimed_by === "gh-run-race-b");

  const activeCount = await pool.query(
    `SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'PRODUCTION' AND status IN ('QUEUED','CLAIMED','RUNNING')`
  );
  assert.equal(activeCount.rows[0].n, "1", "el doble dispatch nunca debe dejar dos corridas activas ni tocar una segunda fila");

  await failRun(started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: compatibilidad con el fencing/heartbeat/recovery existentes - heartbeat + fn_complete_refresh_run funcionan igual sobre una fila reclamada por id", { skip: !TEST_DB_URL }, async () => {
  const started = await startRun("PRODUCTION", "GITHUB");
  const claim = await claimById(started.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-lifecycle");
  assert.equal(claim.claimed, true);

  await pool.query(`SELECT pipeline.fn_heartbeat_refresh_run($1)`, [started.refreshRunId]);
  await pool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [started.refreshRunId, "EXTRACT"]);

  const mid = await runRow(started.refreshRunId);
  assert.equal(mid.status, "RUNNING");
  assert.equal(mid.current_stage, "EXTRACT");
  assert.ok(mid.last_heartbeat_at);

  await pool.query(
    `SELECT pipeline.fn_complete_refresh_run($1,$2,$3,$4,$5,$6,$7,$8)`,
    [started.refreshRunId, ["fieldbeat", "zendesk", "dolibarr"], 10, 10, "PASSED", null, "TEST-SNAPSHOT-CLAIM-BY-ID", null]
  );
  const finished = await runRow(started.refreshRunId);
  assert.equal(finished.status, "SUCCEEDED");

  const published = await pool.query(`SELECT published_refresh_run_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`);
  assert.equal(published.rows[0].published_refresh_run_id, started.refreshRunId);
});

test("fn_claim_refresh_run_by_id: separación de privilegios - solo nexus_pipeline_worker puede ejecutarla, nunca nexus_pipeline_requester", { skip: !TEST_DB_URL }, async () => {
  const grants = await pool.query<{ routine_name: string; grantee: string }>(
    `SELECT r.routine_name, g.grantee
     FROM information_schema.routine_privileges g
     JOIN information_schema.routines r ON r.specific_name = g.specific_name AND r.specific_schema = g.specific_schema
     WHERE g.routine_schema = 'pipeline' AND g.routine_name = 'fn_claim_refresh_run_by_id' AND g.privilege_type = 'EXECUTE'
       AND g.grantee IN ('nexus_pipeline_requester','nexus_pipeline_worker','PUBLIC')`
  );
  const grantees = new Set(grants.rows.map(r => r.grantee));
  assert.ok(grantees.has("nexus_pipeline_worker"), "nexus_pipeline_worker debe poder ejecutar fn_claim_refresh_run_by_id");
  assert.ok(!grantees.has("nexus_pipeline_requester"), "nexus_pipeline_requester NUNCA debe poder ejecutar fn_claim_refresh_run_by_id (solo crea/lee corridas)");
  assert.ok(!grantees.has("PUBLIC"), "PUBLIC nunca debe tener EXECUTE sobre fn_claim_refresh_run_by_id");
});

test("fn_claim_refresh_run_by_id: owner = governance_owner, SECURITY DEFINER, search_path fijo (mismo patrón que sql/101/102)", { skip: !TEST_DB_URL }, async () => {
  const rows = await pool.query<{ owner: string; prosecdef: boolean; proconfig: string[] | null }>(
    `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'pipeline' AND p.proname = 'fn_claim_refresh_run_by_id'`
  );
  assert.equal(rows.rows.length, 1, "fn_claim_refresh_run_by_id debe existir en el schema pipeline");
  const fn = rows.rows[0];
  assert.equal(fn.owner, "governance_owner");
  assert.equal(fn.prosecdef, true, "debe ser SECURITY DEFINER");
  assert.ok(fn.proconfig?.some(c => c.startsWith("search_path=")), "debe fijar search_path explícito (nunca heredar el del caller)");
});
