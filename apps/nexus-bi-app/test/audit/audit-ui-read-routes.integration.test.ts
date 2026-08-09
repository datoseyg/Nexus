// Pruebas de integración de Gate B - Familia 8: rutas de lectura que
// alimentan las nuevas pestañas Resumen/Correcciones/Reglas/Fuentes y
// pipeline. Invariantes cubiertas: ambos roles (gerencia/administracion)
// pueden leer (audit:read); 401 sin sesión; forma de respuesta correcta;
// las consultas nuevas no rompen por falta de grants (correction_versions/
// correction_targets/rule_evaluation_runs, agregados en esta misma familia).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-ui-read-routes-gate-b-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const GOVERNANCE_ENV_VARS = ["GOVERNANCE_APP_READ_DB_URL", "GOVERNANCE_APP_CORRECTIONS_DB_URL", "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL"] as const;

const ENV_FALLBACK_PATH = new URL("../../.env.development.local", import.meta.url);
if (GOVERNANCE_ENV_VARS.some(name => !process.env[name]) && existsSync(ENV_FALLBACK_PATH)) {
  const content = readFileSync(ENV_FALLBACK_PATH, "utf8");
  for (const line of content.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match && GOVERNANCE_ENV_VARS.includes(match[1] as (typeof GOVERNANCE_ENV_VARS)[number]) && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const { Pool } = pg;
let adminPool: pg.Pool;

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "77777777-7777-7777-7777-777777777777", app_metadata: { nexus_role: "administracion" } }, error: null };
    }
  });
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "88888888-8888-8888-8888-888888888888", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("GET /api/audit/kpis - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/audit/kpis/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET();
    assert.equal(response.status, 401);
  });

  await t.test("gerencia y administracion pueden leer - forma de respuesta correcta", async () => {
    asGerencia();
    const gerenciaResponse = await GET();
    assert.equal(gerenciaResponse.status, 200);
    const body = await gerenciaResponse.json();
    assert.ok(Array.isArray(body.byStatus));
    assert.ok(Array.isArray(body.bySeverity));
    assert.ok(Array.isArray(body.byRule));
    assert.ok(Array.isArray(body.byEntityType));
    assert.ok(Array.isArray(body.verification));
    assert.ok(Array.isArray(body.recentCorrections));
    assert.ok(Array.isArray(body.dailyDetections));

    asAdministracion();
    const adminResponse = await GET();
    assert.equal(adminResponse.status, 200);
  });
});

test("GET /api/audit/corrections - integración (historial de versiones)", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/audit/corrections/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET(req("/api/audit/corrections"));
    assert.equal(response.status, 401);
  });

  await t.test("gerencia lee el historial paginado", async () => {
    asGerencia();
    const response = await GET(req("/api/audit/corrections?page=1&pageSize=5"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.rows));
    assert.equal(typeof body.totalRows, "number");
  });

  await t.test("filtro correctionType nunca falla aunque no matchee nada", async () => {
    asAdministracion();
    const response = await GET(req("/api/audit/corrections?correctionType=no-existe-este-tipo"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rows.length, 0);
    assert.equal(body.totalRows, 0);
  });
});

test("GET /api/audit/rules - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/audit/rules/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET();
    assert.equal(response.status, 401);
  });

  await t.test("gerencia lee el catálogo completo de reglas (5 reglas semilla del catálogo mínimo B6)", async () => {
    asGerencia();
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.rows));
    assert.ok(body.rows.length >= 5, "el catálogo mínimo de B6 tiene al menos 5 reglas semilla");
    const ruleCodes = body.rows.map((r: { rule_code: string }) => r.rule_code);
    for (const expected of ["PART_NO_MATCH", "PART_AMBIGUOUS_MATCH", "PART_PLACEHOLDER_VALUE", "REPORT_QUALITY_DEGRADED", "TICKET_LINK_RESTRICTED_OR_MISSING"]) {
      assert.ok(ruleCodes.includes(expected), `falta la regla semilla ${expected}`);
    }
  });
});

test("GET /api/audit/evaluation-runs - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/audit/evaluation-runs/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET(req("/api/audit/evaluation-runs"));
    assert.equal(response.status, 401);
  });

  await t.test("administracion lee las corridas del evaluador, paginado", async () => {
    asAdministracion();
    const response = await GET(req("/api/audit/evaluation-runs?page=1&pageSize=5"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.rows));
    assert.equal(typeof body.totalRows, "number");
  });
});
