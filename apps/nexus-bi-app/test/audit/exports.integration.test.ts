// Pruebas de integración de Gate B - Familia 7: exportación CSV de
// Auditoría (Bandeja, Casos) y Explorador. Invariantes cubiertas: filtros
// server-side (nunca solo la página cargada); protección contra inyección
// de fórmula CSV (OWASP); Gerencia puede exportar sin permisos de escritura
// general (fn_record_export_completed otorgada también a nexus_app_read);
// cada exportación registra exactamente un evento EXPORT_COMPLETED.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-exports-gate-b-test";

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

const ENTITY_KEY = "=formula-injection-test-975601";
const GERENCIA_ACTOR_ID = "88888888-8888-8888-8888-888888888888";
const ADMIN_ACTOR_ID = "77777777-7777-7777-7777-777777777777";

let issueId: number;
let reviewCaseId: number;

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: ADMIN_ACTOR_ID, app_metadata: { nexus_role: "administracion" } }, error: null };
    }
  });
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: GERENCIA_ACTOR_ID, app_metadata: { nexus_role: "gerencia" } }, error: null };
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

  await adminPool.query(`DELETE FROM governance.issues WHERE entity_key = $1`, [ENTITY_KEY]);

  const issueResult = await adminPool.query(
    `INSERT INTO governance.issues
      (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
       severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
     VALUES ($1, 'PART_NO_MATCH', 1, 1, 'part_occurrence', $2, $2, 'MEDIUM', 'OPEN', now(), now(), now(), true)
     RETURNING id`,
    ["exports-test-fingerprint", ENTITY_KEY]
  );
  issueId = Number(issueResult.rows[0].id);

  const caseResult = await adminPool.query(`INSERT INTO governance.review_cases (status) VALUES ('OPEN') RETURNING id`);
  reviewCaseId = Number(caseResult.rows[0].id);
  await adminPool.query(`INSERT INTO governance.review_case_issues (review_case_id, issue_id, added_by_actor_id) VALUES ($1, $2, $3)`, [
    reviewCaseId,
    issueId,
    ADMIN_ACTOR_ID
  ]);
});

afterAll(async () => {
  if (!TEST_DB_URL) return;

  await adminPool.query(`DELETE FROM governance.command_events WHERE issue_id = $1 OR review_case_id = $2`, [issueId, reviewCaseId]);
  await adminPool.query(
    `DELETE FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id IN ($1, $2)
       AND created_at > now() - interval '5 minutes'`,
    [ADMIN_ACTOR_ID, GERENCIA_ACTOR_ID]
  );
  await adminPool.query(`DELETE FROM governance.review_case_issues WHERE review_case_id = $1`, [reviewCaseId]);
  await adminPool.query(`DELETE FROM governance.review_cases WHERE id = $1`, [reviewCaseId]);
  await adminPool.query(`DELETE FROM governance.issues WHERE id = $1`, [issueId]);

  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("GET /api/audit/issues/export - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/audit/issues/export/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET(req("/api/audit/issues/export"));
    assert.equal(response.status, 401);
  });

  await t.test("gerencia PUEDE exportar (sin permisos de escritura general, B76)", async () => {
    asGerencia();
    const response = await GET(req(`/api/audit/issues/export?q=${encodeURIComponent("formula-injection-test")}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
    const text = await response.text();
    assert.ok(text.includes("'=formula-injection-test-975601"), "el valor con forma de fórmula debe llevar el prefijo defensivo '");
    assert.ok(!text.includes(",=formula-injection-test-975601"), "el valor nunca debe aparecer inmediatamente tras una coma sin el prefijo defensivo");
  });

  await t.test("administracion también puede exportar - EXPORT_COMPLETED registrado con el rowCount real", async () => {
    asAdministracion();
    const response = await GET(req(`/api/audit/issues/export?q=${encodeURIComponent("formula-injection-test")}`));
    assert.equal(response.status, 200);

    const events = await adminPool.query(
      `SELECT after_state FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1`,
      [ADMIN_ACTOR_ID]
    );
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].after_state.entityType, "audit-issues");
    assert.equal(events.rows[0].after_state.rowCount, 1);
  });
});

test("GET /api/audit/review-cases/export - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/audit/review-cases/export/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET(req("/api/audit/review-cases/export"));
    assert.equal(response.status, 401);
  });

  await t.test("gerencia exporta y el caso fixture aparece en el CSV", async () => {
    asGerencia();
    const response = await GET(req("/api/audit/review-cases/export?status=OPEN"));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes(String(reviewCaseId)));

    const events = await adminPool.query(
      `SELECT after_state FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1`,
      [GERENCIA_ACTOR_ID]
    );
    assert.equal(events.rows[0].after_state.entityType, "audit-review-cases");
  });
});

test("GET /api/explorer/[entity]/export - integración (entidad issues)", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/explorer/[entity]/export/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET(req("/api/explorer/issues/export"), { params: Promise.resolve({ entity: "issues" }) });
    assert.equal(response.status, 401);
  });

  await t.test("entidad no soportada -> 404 NOT_FOUND", async () => {
    asAdministracion();
    const response = await GET(req("/api/explorer/nope/export"), { params: Promise.resolve({ entity: "nope" }) });
    assert.equal(response.status, 404);
  });

  await t.test("exporta la entidad issues completa - headers correctos, EXPORT_COMPLETED registrado", async () => {
    asAdministracion();
    const response = await GET(req("/api/explorer/issues/export"), { params: Promise.resolve({ entity: "issues" }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
    const text = await response.text();
    // entity_key no está en listColumns de "issues" (B21 - allowlist propio
    // de la tabla en pantalla, no expone la clave de entidad cruda) - se
    // verifica el header real y que el universo incluye al menos el fixture,
    // identificado por su TÍTULO de negocio (governance.rule_definitions.title,
    // "Repuesto sin coincidencia" para PART_NO_MATCH v1) - nunca por el
    // rule_code crudo, que es exactamente lo que esta exportación no debe
    // mostrar (corrección de negocio de Auditoría, sección 16/17).
    assert.ok(text.startsWith("Regla,Severidad,Estado,Entidad afectada,"));
    assert.ok(text.includes("Repuesto sin coincidencia"));
    assert.ok(!text.includes("PART_NO_MATCH"), "el código crudo de la regla nunca debe aparecer en la exportación de negocio");

    const events = await adminPool.query(
      `SELECT after_state FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1`,
      [ADMIN_ACTOR_ID]
    );
    assert.equal(events.rows[0].after_state.entityType, "explorer-issues");
  });
});
