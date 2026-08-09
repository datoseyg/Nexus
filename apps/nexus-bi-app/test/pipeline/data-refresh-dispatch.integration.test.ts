// NEXUS V3 - puente POST /api/data-refresh/runs -> GitHub Actions
// workflow_dispatch. Integración real contra Postgres desechable (mismo
// mecanismo que test/audit/corrections-part-alias.integration.test.ts: la
// ruta HTTP se invoca directo, sin servidor Next.js, con
// setAuthorizationProviderForTests) - SOLO la llamada saliente hacia GitHub
// se mockea (globalThis.fetch vía node:test), nunca Supabase/Postgres.
//
// Reescrito tras 3 blockers de revisión de producto (ver commits/reporte):
//   1. El body HTTP YA NO transporta environment/executorType - el backend
//      los resuelve server-side vía NEXUS_REFRESH_ENVIRONMENT (ver
//      route.ts::resolveRefreshEnvironment). Estos tests controlan el
//      destino con esa variable de entorno, nunca con el body.
//   2. El reclamo automático por refresh_run_id ahora es EXACTO
//      (pipeline.fn_claim_refresh_run_by_id, sql/110) - cobertura DB
//      dedicada en test/pipeline/claim-refresh-run-by-id.integration.test.ts;
//      acá solo se usa de forma incidental para simular que un worker real
//      avanzó una corrida a RUNNING.
//   3. El dispatch ahora reintenta mientras la corrida SIGA QUEUED en vivo,
//      sin importar result.status/result.replay (ambos pueden ser
//      engañosos - ver el comentario de liveRefreshRunStatus en route.ts).
//
// La lógica pura de correlación (checkRefreshRunClaimMatchesExpectation) y
// el módulo de dispatch en sí (lib/github-actions-dispatch.ts) ya tienen
// cobertura unitaria propia (test/pipeline/run-data-refresh.test.js,
// test/data-refresh/github-actions-dispatch.test.ts) - este archivo cubre
// específicamente que la RUTA los conecte bien: cuándo dispara, cuándo no,
// qué devuelve, y que un fallo de dispatch nunca se oculte ni se confunda
// con una escritura fallida (la fila QUEUED es real de cualquier forma).
import { test, before, after as afterAll, mock } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "pipeline-data-refresh-dispatch-test";

// La ruta HTTP real (POST importado abajo) conecta vía lib/governance-db.ts,
// que exige DATABASE_SSL_MODE explícito para permitir un host local sin TLS
// (ver lib/db.ts::resolveSslMode) - mismo ajuste que
// test/audit/corrections-part-alias.integration.test.ts.
if (TEST_DB_URL) {
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
});

afterAll(async () => {
  delete process.env.NEXUS_REFRESH_ENVIRONMENT;
  if (adminPool) await adminPool.end();
});

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), init);
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return {
        user: { id: "33333333-3333-3333-3333-333333333333", app_metadata: { nexus_role: "administracion" } },
        error: null
      };
    }
  });
}

async function failRun(refreshRunId: string, partial = false) {
  await adminPool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [refreshRunId, "TEST_CLEANUP", "cierre de prueba", partial]);
}

async function runRow(refreshRunId: string) {
  const r = await adminPool.query(`SELECT * FROM pipeline.refresh_runs WHERE refresh_run_id = $1`, [refreshRunId]);
  return r.rows[0];
}

// Blocker 1 - el destino ya no lo decide el body HTTP, lo decide esta
// variable server-only (mismo nombre que lee route.ts::resolveRefreshEnvironment).
function setRefreshEnvironment(value: "LOCAL" | "STAGING" | "PRODUCTION") {
  process.env.NEXUS_REFRESH_ENVIRONMENT = value;
}
function clearRefreshEnvironment() {
  delete process.env.NEXUS_REFRESH_ENVIRONMENT;
}

const DISPATCH_ENV_VARS = [
  "GITHUB_ACTIONS_DISPATCH_TOKEN",
  "GITHUB_ACTIONS_DISPATCH_OWNER",
  "GITHUB_ACTIONS_DISPATCH_REPO",
  "GITHUB_ACTIONS_DISPATCH_WORKFLOW",
  "GITHUB_ACTIONS_DISPATCH_REF"
];
const FAKE_TOKEN = "integration-test-dispatch-token-never-real";

function clearDispatchEnv() {
  for (const name of DISPATCH_ENV_VARS) delete process.env[name];
}

function setDispatchEnv() {
  clearDispatchEnv();
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = FAKE_TOKEN;
  process.env.GITHUB_ACTIONS_DISPATCH_OWNER = "eyg-test-org";
  process.env.GITHUB_ACTIONS_DISPATCH_REPO = "eyg-nexus-production";
}

test("POST /api/data-refresh/runs - dispatch a GitHub Actions", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/data-refresh/runs/route.ts");

  await t.test("NEXUS_REFRESH_ENVIRONMENT=PRODUCTION -> 202 QUEUED PRODUCTION/GITHUB + exactamente un dispatch, refresh_run_id correcto en los inputs del workflow", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    setDispatchEnv();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    });

    try {
      const response = await POST(
        req("/api/data-refresh/runs", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-prod-1" },
          body: JSON.stringify({ mode: "INCREMENTAL" })
        })
      );
      assert.equal(response.status, 202);
      const body = await response.json();
      assert.equal(body.status, "QUEUED");
      assert.deepEqual(body.dispatch, { ok: true });
      assert.equal(calls.length, 1, "debe disparar el workflow exactamente una vez");

      const sentInputs = JSON.parse(calls[0].init.body as string).inputs;
      assert.equal(sentInputs.refresh_run_id, body.refreshRunId, "el workflow debe recibir el mismo refresh_run_id que la fila QUEUED recién creada");
      assert.equal(sentInputs.environment, "PRODUCTION");

      const row = await runRow(body.refreshRunId);
      assert.equal(row.status, "QUEUED");
      assert.equal(row.environment, "PRODUCTION");
      assert.equal(row.executor_type, "GITHUB");

      await failRun(body.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("NEXUS_REFRESH_ENVIRONMENT sin configurar -> default LOCAL/LOCAL, nunca dispara GitHub Actions aunque la config de dispatch esté presente", async () => {
    asAdministracion();
    clearRefreshEnvironment();
    setDispatchEnv();
    let fetchCalled = false;
    mock.method(globalThis, "fetch", async () => {
      fetchCalled = true;
      return new Response(null, { status: 204 });
    });

    try {
      const response = await POST(
        req("/api/data-refresh/runs", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-default-local-1" },
          body: JSON.stringify({ mode: "INCREMENTAL" })
        })
      );
      assert.equal(response.status, 202);
      const body = await response.json();
      assert.equal(body.status, "QUEUED");
      assert.equal(body.dispatch, undefined, "LOCAL nunca debe llevar campo dispatch -ese camino lo cubre local-refresh-worker.mjs por polling");
      assert.equal(fetchCalled, false);

      const row = await runRow(body.refreshRunId);
      assert.equal(row.environment, "LOCAL");
      assert.equal(row.executor_type, "LOCAL");

      await failRun(body.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("blocker 1: el body HTTP no puede forzar otro entorno - NEXUS_REFRESH_ENVIRONMENT=PRODUCTION gana aunque el body diga LOCAL/LOCAL", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    setDispatchEnv();
    const calls: unknown[] = [];
    mock.method(globalThis, "fetch", async () => {
      calls.push(true);
      return new Response(null, { status: 204 });
    });

    try {
      // Cliente viejo/manipulado: intenta forzar LOCAL a mano en el body.
      const response = await POST(
        req("/api/data-refresh/runs", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-force-local-1" },
          body: JSON.stringify({ mode: "INCREMENTAL", environment: "LOCAL", executorType: "LOCAL" })
        })
      );
      const body = await response.json();
      assert.equal(body.dispatch?.ok, true, "el servidor debe seguir resolviendo PRODUCTION/GITHUB e intentar el dispatch, ignorando el body");

      const row = await runRow(body.refreshRunId);
      assert.equal(row.environment, "PRODUCTION", "environment nunca debe venir del body");
      assert.equal(row.executor_type, "GITHUB", "executorType nunca debe venir del body");
      assert.equal(calls.length, 1);

      await failRun(body.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("blocker 1 (inverso): NEXUS_REFRESH_ENVIRONMENT=LOCAL gana aunque el body diga PRODUCTION/GITHUB - nunca dispara GitHub Actions", async () => {
    asAdministracion();
    setRefreshEnvironment("LOCAL");
    setDispatchEnv();
    let fetchCalled = false;
    mock.method(globalThis, "fetch", async () => {
      fetchCalled = true;
      return new Response(null, { status: 204 });
    });

    try {
      const response = await POST(
        req("/api/data-refresh/runs", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-force-prod-1" },
          body: JSON.stringify({ mode: "INCREMENTAL", environment: "PRODUCTION", executorType: "GITHUB" })
        })
      );
      const body = await response.json();
      assert.equal(body.dispatch, undefined, "un body que reclama PRODUCTION/GITHUB nunca debe disparar un dispatch si el deployment está configurado como LOCAL");

      const row = await runRow(body.refreshRunId);
      assert.equal(row.environment, "LOCAL");
      assert.equal(row.executor_type, "LOCAL");
      assert.equal(fetchCalled, false, "un deployment LOCAL nunca debe siquiera intentar la llamada HTTP a GitHub, sin importar el body");

      await failRun(body.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("falta configuración de dispatch (sin token) -> la fila QUEUED igual se crea, pero dispatch.ok=false y se registra visiblemente (nunca oculto)", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    clearDispatchEnv(); // ninguna variable GITHUB_ACTIONS_DISPATCH_* configurada
    let fetchCalled = false;
    mock.method(globalThis, "fetch", async () => {
      fetchCalled = true;
      return new Response(null, { status: 204 });
    });
    const errorLogs: unknown[][] = [];
    mock.method(console, "error", (...args: unknown[]) => {
      errorLogs.push(args);
    });

    try {
      const response = await POST(
        req("/api/data-refresh/runs", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-no-token-1" },
          body: JSON.stringify({ mode: "INCREMENTAL" })
        })
      );
      assert.equal(response.status, 202, "la creación de la fila QUEUED es real e independiente de si el dispatch pudo salir");
      const body = await response.json();
      assert.equal(body.status, "QUEUED");
      assert.equal(body.dispatch.ok, false);
      assert.match(body.dispatch.reason, /GITHUB_ACTIONS_DISPATCH_TOKEN/);
      assert.equal(fetchCalled, false, "sin token configurado, nunca debe siquiera intentar la llamada HTTP");
      assert.ok(errorLogs.length > 0, "un dispatch fallido debe quedar registrado en el log del servidor, nunca en silencio");

      await failRun(body.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("GitHub responde con error -> dispatch.ok=false, nunca convierte el 202 en un error HTTP, el token nunca aparece en la respuesta", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    setDispatchEnv();
    mock.method(globalThis, "fetch", async () => new Response("forbidden", { status: 403 }));

    try {
      const response = await POST(
        req("/api/data-refresh/runs", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-403-1" },
          body: JSON.stringify({ mode: "INCREMENTAL" })
        })
      );
      assert.equal(response.status, 202);
      const rawBody = await response.text();
      assert.doesNotMatch(rawBody, new RegExp(FAKE_TOKEN), "el token nunca debe aparecer en la respuesta HTTP");
      const body = JSON.parse(rawBody);
      assert.equal(body.status, "QUEUED");
      assert.equal(body.dispatch.ok, false);
      assert.match(body.dispatch.reason, /403/);

      await failRun(body.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("blocker 3: reintento (misma Idempotency-Key) tras un dispatch fallido, mientras la corrida sigue QUEUED -> reintenta el dispatch y puede tener éxito", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    setDispatchEnv();
    let callCount = 0;
    mock.method(globalThis, "fetch", async () => {
      callCount += 1;
      return callCount === 1 ? new Response("server error", { status: 500 }) : new Response(null, { status: 204 });
    });

    try {
      const requestInit = {
        method: "POST" as const,
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-retry-replay-1" },
        body: JSON.stringify({ mode: "INCREMENTAL" })
      };

      const first = await POST(req("/api/data-refresh/runs", requestInit));
      const firstBody = await first.json();
      assert.equal(firstBody.dispatch.ok, false);
      assert.match(firstBody.dispatch.reason, /500/);

      // Mismo Idempotency-Key -> replay:true, con un response_snapshot
      // CONGELADO (status:"QUEUED" tal como quedó en la creación original) -
      // antes del fix, `!result.replay` bloqueaba cualquier reintento acá.
      const second = await POST(req("/api/data-refresh/runs", requestInit));
      const secondBody = await second.json();
      assert.equal(secondBody.replay, true);
      assert.equal(secondBody.refreshRunId, firstBody.refreshRunId);
      assert.ok(secondBody.dispatch, "el replay mientras la corrida sigue QUEUED debe reintentar el dispatch, nunca omitirlo en silencio");
      assert.equal(secondBody.dispatch.ok, true, "el segundo intento sí tiene éxito -GitHub ya no responde 500");

      assert.equal(callCount, 2, "debe haber reintentado la llamada HTTP a GitHub de verdad, no solo repetido la primera respuesta");

      const row = await runRow(firstBody.refreshRunId);
      assert.equal(row.status, "QUEUED", "el reintento de dispatch por sí solo no reclama la fila -eso lo hace fn_claim_refresh_run_by_id del lado del worker");

      await failRun(firstBody.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("blocker 3: replay mientras la corrida YA NO está QUEUED (RUNNING) -> nunca reintenta el dispatch, la fila sigue intacta", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    setDispatchEnv();
    const calls: unknown[] = [];
    mock.method(globalThis, "fetch", async () => {
      calls.push(true);
      return new Response(null, { status: 204 });
    });

    try {
      const requestInit = {
        method: "POST" as const,
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-replay-running-1" },
        body: JSON.stringify({ mode: "INCREMENTAL" })
      };

      const first = await POST(req("/api/data-refresh/runs", requestInit));
      const firstBody = await first.json();
      assert.equal(firstBody.dispatch.ok, true);
      assert.equal(calls.length, 1);

      // Simula que un worker real ya reclamó y avanzó la corrida - mismas
      // funciones gobernadas que usaría scripts/pipeline/run-data-refresh.mjs
      // (fn_claim_refresh_run_by_id, sql/110), nunca un UPDATE crudo.
      const claim = await adminPool.query(
        `SELECT pipeline.fn_claim_refresh_run_by_id($1,$2,$3,$4) AS result`,
        [firstBody.refreshRunId, "PRODUCTION", "GITHUB", "gh-run-test-worker"]
      );
      assert.equal(claim.rows[0].result.claimed, true);
      await adminPool.query(`SELECT pipeline.fn_update_refresh_run_stage($1,$2)`, [firstBody.refreshRunId, "EXTRACT"]);

      // Mismo Idempotency-Key -> replay:true; el snapshot CONGELADO todavía
      // dice status:"QUEUED" (así quedó al crearse) - exactamente por lo que
      // route.ts relee el status VIVO en vez de confiar en este campo.
      const second = await POST(req("/api/data-refresh/runs", requestInit));
      const secondBody = await second.json();
      assert.equal(secondBody.replay, true);
      assert.equal(secondBody.status, "QUEUED", "precondición del test: el snapshot congelado de idempotencia sigue diciendo QUEUED");
      assert.equal(secondBody.dispatch, undefined, "un replay sobre una corrida que ya avanzó a RUNNING nunca debe reintentar el dispatch");

      assert.equal(calls.length, 1, "ningún dispatch adicional - la relectura de status vivo evita un segundo workflow_dispatch para una corrida que ya se está procesando");

      const row = await runRow(firstBody.refreshRunId);
      assert.equal(row.status, "RUNNING", "la corrida real sigue RUNNING, sin que el replay la haya tocado");

      await failRun(firstBody.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });

  await t.test("dos POST concurrentes para el mismo entorno (idempotency keys distintas) -> ambas respuestas apuntan a LA MISMA fila, cualquier dispatch resultante (1 o 2) referencia ese único refresh_run_id", async () => {
    asAdministracion();
    setRefreshEnvironment("PRODUCTION");
    setDispatchEnv();
    const calls: Array<{ init: RequestInit }> = [];
    mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      calls.push({ init });
      return new Response(null, { status: 204 });
    });

    try {
      const [a, b] = await Promise.all([
        POST(
          req("/api/data-refresh/runs", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-race-a" },
            body: JSON.stringify({ mode: "INCREMENTAL" })
          })
        ),
        POST(
          req("/api/data-refresh/runs", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dispatch-test-race-b" },
            body: JSON.stringify({ mode: "INCREMENTAL" })
          })
        )
      ]);
      const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);
      const statuses = [bodyA.status, bodyB.status].sort();
      assert.deepEqual(statuses, ["ALREADY_RUNNING", "QUEUED"]);
      assert.equal(bodyA.refreshRunId, bodyB.refreshRunId, "ambas respuestas deben apuntar a la misma fila activa");

      // Ambas respuestas leen el status vivo de LA MISMA fila (nadie la ha
      // reclamado todavía - eso solo lo hace un worker real, fuera de este
      // POST) - por diseño (blocker 3: "el reintento debe funcionar
      // mientras siga QUEUED"), es válido que las dos vean QUEUED y ambas
      // intenten el dispatch. Eso es exactamente el escenario "doble
      // workflow_dispatch para el mismo refresh_run_id" que el requisito
      // declara explícitamente inocuo: pipeline.fn_claim_refresh_run_by_id
      // (sql/110, cobertura dedicada en
      // test/pipeline/claim-refresh-run-by-id.integration.test.ts) garantiza
      // que solo UNO de esos dos workflows podrá reclamar de verdad -
      // nunca una tercera fila. Acá solo se verifica que, sin importar si
      // hubo 1 o 2 llamadas, TODAS referencian el mismo refresh_run_id.
      assert.ok(calls.length >= 1 && calls.length <= 2, `se esperaban 1 o 2 llamadas de dispatch, hubo ${calls.length}`);
      for (const call of calls) {
        const sentRefreshRunId = JSON.parse(call.init.body as string).inputs.refresh_run_id;
        assert.equal(sentRefreshRunId, bodyA.refreshRunId, "cualquier dispatch disparado por esta carrera debe referenciar la única fila activa, nunca otra");
      }

      await failRun(bodyA.refreshRunId);
    } finally {
      mock.restoreAll();
      clearDispatchEnv();
      clearRefreshEnvironment();
    }
  });
});

// Contrato de DB que scripts/pipeline/run-data-refresh.mjs::checkRefreshRunClaimMatchesExpectation
// asume como defensa en profundidad (YA NO el mecanismo principal - ver
// pipeline.fn_claim_refresh_run_by_id, sql/110, y su cobertura dedicada en
// test/pipeline/claim-refresh-run-by-id.integration.test.ts): marcar la
// corrida reclamada por error como FAILED con DISPATCH_CORRELATION_MISMATCH,
// sin tocar el snapshot publicado ni dejarla en un estado ambiguo. La
// lógica de DECISIÓN (pura, sin DB) ya se prueba en
// test/pipeline/run-data-refresh.test.js - esto valida que el mecanismo real
// de recuperación (fn_fail_refresh_run) se comporta como ese código espera.
test("DISPATCH_CORRELATION_MISMATCH: fn_fail_refresh_run dado ese código deja la corrida FAILED, sin tocar el snapshot publicado", { skip: !TEST_DB_URL }, async () => {
  const publishedBefore = await adminPool.query(
    `SELECT published_refresh_run_id, source_snapshot_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`
  );

  const started = await adminPool.query(
    `SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
    ["PRODUCTION", "INCREMENTAL", "GITHUB", null, "administracion", false, null, null, null]
  );
  assert.equal(started.rows[0].result.status, "QUEUED", "precondición del test: debe partir de una corrida QUEUED nueva, sin idempotency_key (no es replay lo que se prueba acá)");
  const refreshRunId = started.rows[0].result.refreshRunId;

  const claim = await adminPool.query(`SELECT pipeline.fn_claim_next_refresh_run($1,$2,$3) AS result`, ["PRODUCTION", "GITHUB", "gh-run-stale-dispatch"]);
  assert.equal(claim.rows[0].result.claimed, true);
  assert.equal(claim.rows[0].result.refreshRunId, refreshRunId);

  const reason = `refresh_run_id reclamado (${refreshRunId}) no coincide con el esperado por este dispatch (00000000-0000-0000-0000-000000000000).`;
  await adminPool.query(`SELECT pipeline.fn_fail_refresh_run($1,$2,$3,$4)`, [refreshRunId, "DISPATCH_CORRELATION_MISMATCH", reason, false]);

  const row = await runRow(refreshRunId);
  assert.equal(row.status, "FAILED");
  assert.equal(row.error_code, "DISPATCH_CORRELATION_MISMATCH");
  assert.equal(row.error_summary, reason);

  const publishedAfter = await adminPool.query(
    `SELECT published_refresh_run_id, source_snapshot_id FROM pipeline.published_dataset_state WHERE environment_key = 'PRODUCTION'`
  );
  assert.deepEqual(publishedAfter.rows[0], publishedBefore.rows[0], "un mismatch de correlación nunca debe tocar el snapshot publicado");

  const activeCount = await adminPool.query(
    `SELECT COUNT(*) AS n FROM pipeline.refresh_runs WHERE environment = 'PRODUCTION' AND status IN ('QUEUED','CLAIMED','RUNNING')`
  );
  assert.equal(activeCount.rows[0].n, "0", "el entorno queda libre para un futuro dispatch manual (sin refresh_run_id) que sí reclame trabajo nuevo");
});
