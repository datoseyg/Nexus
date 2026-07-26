// Pruebas de integración de Phase 6 - "Abrir en FieldBeat" (riesgo
// aceptado 27.B) - mismo mecanismo de Postgres desechable que
// test/fieldbeat/quality-api.integration.test.ts (ver ese archivo para el
// contexto completo del incidente ETAPA SAFETY-1).
//
// Rango de fieldbeat_task_id propio (902001-902003) y client_key con
// prefijo "OPENURL|" - disjunto de 900001-900020/901001-901026 (quality/
// paginación) y de cualquier fieldbeat_task_id real (máximo observado en
// la reconciliación local: 3777).
//
// FIELDBEAT_FLEET/FIELDBEAT_REPORT_TOKEN usan SIEMPRE valores centinela
// ("sentinel-fleet"/"sentinel-token-do-not-use") - nunca un valor real de
// producción, ni siquiera en un fixture de prueba local.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "fieldbeat-open-route-phase6-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_KEY = "OPENURL|77.777.777-7|Cliente Fixture Open Route";
const CLIENT_NAME = "Cliente Fixture Open Route";
const ID_MIN = 902001;
const ID_MAX = 902003;
const NONEXISTENT_ID = "999999998";

const SENTINEL_FLEET = "sentinel-fleet";
const SENTINEL_TOKEN = "sentinel-token-do-not-use";
const ENV_KEYS = ["FIELDBEAT_FLEET", "FIELDBEAT_REPORT_TOKEN"] as const;

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function openReq(id: string) {
  return { params: Promise.resolve({ id }) };
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "fieldbeat-open-route-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  return fn().finally(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

async function insertTask(id: number) {
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_tasks
       (fieldbeat_task_id, client_key, assigned_to, task_type, state, start_time, last_transition_at, duration_minutes, created_at, created_in)
     VALUES ($1,$2,'fixture_tech','PM','FINISHED','2026-03-10T14:00:00Z','2026-03-10T15:00:00Z',45,'2026-03-10T13:00:00Z','APK')`,
    [id, CLIENT_KEY]
  );
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
       (fieldbeat_task_id, fieldbeat_task_date, client_key, client_name, task_type, task_state, technician_names, equipment_internal_ids, used_parts_count, report_quality_status)
     VALUES ($1,'2026-03-10T14:00:00Z',$2,$3,'PM','FINISHED','Técnico Fixture','EQ-OPENURL-1',0,'NO_USED_PARTS')`,
    [id, CLIENT_KEY, CLIENT_NAME]
  );
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);

  for (let id = ID_MIN; id <= ID_MAX; id++) await insertTask(id);
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("open: 401 sin sesión", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
  assert.equal(res.status, 401);
});

test("open: 403 con rol no autorizado", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "x", app_metadata: { nexus_role: "tecnico" } }, error: null }; }
  });
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
  assert.equal(res.status, 403);
});

test("open: 400 con ID inválido (decimal/negativo/cero/texto/notación científica)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
  asGerencia();
  for (const badId of ["0", "-5", "3.5", "abc", "1e10", "007"]) {
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${badId}/open`), openReq(badId));
    assert.equal(res.status, 400, `ID "${badId}" debería ser 400`);
  }
});

test("open: 503 sin indicar cuál falta cuando FIELDBEAT_FLEET está ausente (reporte existente)", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_REPORT_TOKEN: SENTINEL_TOKEN }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, "FIELDBEAT_OPEN_NOT_CONFIGURED");
    assert.doesNotMatch(JSON.stringify(body), /FIELDBEAT_FLEET|FIELDBEAT_REPORT_TOKEN/, "nunca debe indicar cuál variable falta");
  })
);

test("open: 503 sin indicar cuál falta cuando FIELDBEAT_REPORT_TOKEN está ausente", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_FLEET: SENTINEL_FLEET }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
    assert.equal(res.status, 503);
  })
);

test("open: 503 cuando ambas variables están ausentes, incluso si el reporte NO existe (config se valida primero)", { skip: !TEST_DB_URL }, () =>
  withEnv({}, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${NONEXISTENT_ID}/open`), openReq(NONEXISTENT_ID));
    assert.equal(res.status, 503);
  })
);

test("open: 404 cuando el reporte no existe (config presente)", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_FLEET: SENTINEL_FLEET, FIELDBEAT_REPORT_TOKEN: SENTINEL_TOKEN }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${NONEXISTENT_ID}/open`), openReq(NONEXISTENT_ID));
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, "NOT_FOUND");
  })
);

test("open: 302 con Location fija (host/protocolo/path) y fleet/task_id/token correctos cuando el reporte existe y la config está presente", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_FLEET: SENTINEL_FLEET, FIELDBEAT_REPORT_TOKEN: SENTINEL_TOKEN }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
    assert.equal(res.status, 302);

    const location = res.headers.get("location");
    assert.ok(location, "debe traer header Location");
    const parsed = new URL(location!);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "teams.fieldbeat.com");
    assert.equal(parsed.pathname, "/");
    assert.equal(parsed.hash, `#/reportes/tarea?fleet=${SENTINEL_FLEET}&task_id=${ID_MIN}&token=${SENTINEL_TOKEN}`);
  })
);

test("open: headers Cache-Control: private, no-store y Referrer-Policy: no-referrer en la respuesta 302", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_FLEET: SENTINEL_FLEET, FIELDBEAT_REPORT_TOKEN: SENTINEL_TOKEN }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  })
);

test("open: el ID de la URL de la petición nunca puede alterar host/protocolo/path del redirect (no open redirect)", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_FLEET: SENTINEL_FLEET, FIELDBEAT_REPORT_TOKEN: SENTINEL_TOKEN }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();
    // parseFieldbeatTaskId ya rechaza cualquier ID no numérico (400 antes de
    // construir la URL) - lo que confirma este test es que NINGÚN dato de
    // la petición entrante (más allá del propio path param, ya validado)
    // puede tocar host/protocolo/path: la URL sale siempre de
    // buildFieldbeatExternalUrl con la constante fija.
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
    const location = res.headers.get("location")!;
    assert.ok(location.startsWith("https://teams.fieldbeat.com/#/reportes/tarea?"));
  })
);

test("open: el log seguro nunca imprime el token ni la URL externa completa (solo reportId + resultado + timestamp)", { skip: !TEST_DB_URL }, () =>
  withEnv({ FIELDBEAT_FLEET: SENTINEL_FLEET, FIELDBEAT_REPORT_TOKEN: SENTINEL_TOKEN }, async () => {
    const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/open/route.ts");
    asGerencia();

    const originalLog = console.log;
    const capturedLines: string[] = [];
    console.log = (...args: unknown[]) => { capturedLines.push(args.map(String).join(" ")); };
    try {
      await GET(req(`/api/dashboard/fieldbeat/reports/${ID_MIN}/open`), openReq(String(ID_MIN)));
    } finally {
      console.log = originalLog;
    }

    const joined = capturedLines.join("\n");
    assert.doesNotMatch(joined, new RegExp(SENTINEL_TOKEN), "el token nunca debe aparecer en un log");
    assert.doesNotMatch(joined, /teams\.fieldbeat\.com/, "la URL externa completa nunca debe aparecer en un log");
    assert.match(joined, new RegExp(`reportId=${ID_MIN}`), "el log SÍ debe incluir el reportId (dato seguro)");
    assert.match(joined, /result=REDIRECT/, "el log SÍ debe incluir el código de resultado (dato seguro)");
  })
);
