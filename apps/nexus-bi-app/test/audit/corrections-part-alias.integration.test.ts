// Pruebas de integración de Gate B - primera ruta HTTP de corrección
// (POST /api/audit/corrections/part-alias) contra un Postgres 16 real y
// DESECHABLE - mismo mecanismo de seguridad que test/fieldbeat/*.integration
// (ver ese archivo para el contexto completo del incidente ETAPA SAFETY-1).
// Reutiliza AFTER_HOURS_TEST_DATABASE_URL/AFTER_HOURS_TEST_RUN_ID (nombre
// histórico, apunta genéricamente "al Postgres desechable de integración").
//
// Los roles de gobierno (nexus_app_read/nexus_app_corrections/
// nexus_command_attempt_logger) deben existir y tener contraseña local ya
// fijada contra ESE MISMO destino antes de correr esta suite -ver
// scripts/set-local-governance-role-passwords.mjs. Si GOVERNANCE_*_DB_URL no
// está ya en el entorno, se leen desde
// apps/nexus-bi-app/.env.development.local como fallback (mismo patrón que
// el resto de la suite usa para SUPABASE_DB_URL vía TEST_DB_URL) - nunca se
// imprime ninguno de esos valores.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-corrections-part-alias-gate-b-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const GOVERNANCE_ENV_VARS = [
  "GOVERNANCE_APP_READ_DB_URL",
  "GOVERNANCE_APP_CORRECTIONS_DB_URL",
  "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL"
] as const;

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

const ALIAS_PREFIX = "AUDITROUTE-";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), init);
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return {
        user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: { nexus_role: "administracion" } },
        error: null
      };
    }
  });
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return {
        user: { id: "22222222-2222-2222-2222-222222222222", app_metadata: { nexus_role: "gerencia" } },
        error: null
      };
    }
  });
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM manual_review.part_aliases WHERE alias_value LIKE $1`, [`${ALIAS_PREFIX}%`]);
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`DELETE FROM manual_review.part_aliases WHERE alias_value LIKE $1`, [`${ALIAS_PREFIX}%`]);
  await adminPool.end();
});

test("POST /api/audit/corrections/part-alias - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/corrections/part-alias/route.ts");

  await t.test("rechaza sin header Origin (403 FORBIDDEN)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "test-no-origin" },
        body: JSON.stringify({ aliasValue: `${ALIAS_PREFIX}1`, aliasType: "RAW", dolibarrProductId: 1, reason: "x" })
      })
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, "FORBIDDEN");
  });

  await t.test("rechaza sin Idempotency-Key (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ aliasValue: `${ALIAS_PREFIX}2`, aliasType: "RAW", dolibarrProductId: 1, reason: "x" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("rechaza a gerencia (sin la capacidad correction:part-alias) con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "test-gerencia-forbidden" },
        body: JSON.stringify({ aliasValue: `${ALIAS_PREFIX}3`, aliasType: "RAW", dolibarrProductId: 1, reason: "x" })
      })
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, "FORBIDDEN");
  });

  await t.test("rechaza sin reason (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "test-no-reason" },
        body: JSON.stringify({ aliasValue: `${ALIAS_PREFIX}4`, aliasType: "RAW", dolibarrProductId: 1 })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("administracion con Origin + Idempotency-Key + reason -> 200 APPLIED, replay en la segunda llamada", async () => {
    asAdministracion();
    const idempotencyKey = "test-part-alias-happy-path";
    const requestInit = {
      method: "POST" as const,
      headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ aliasValue: `${ALIAS_PREFIX}5`, aliasType: "RAW", dolibarrProductId: 424242, reason: "integration test happy path" })
    };

    const firstResponse = await POST(req("/api/audit/corrections/part-alias", requestInit));
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.result, "APPLIED");
    assert.equal(firstBody.replay, false);
    assert.equal(firstBody.target.type, "PART_ALIAS");
    assert.equal(firstBody.target.key.aliasValue, `${ALIAS_PREFIX}5`);

    const secondResponse = await POST(req("/api/audit/corrections/part-alias", requestInit));
    assert.equal(secondResponse.status, 200);
    const secondBody = await secondResponse.json();
    assert.equal(secondBody.replay, true);
    assert.equal(secondBody.correctionVersionId, firstBody.correctionVersionId);

    const rows = await adminPool.query("SELECT alias_value, dolibarr_product_id, active FROM manual_review.part_aliases WHERE alias_value = $1", [`${ALIAS_PREFIX}5`]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].dolibarr_product_id, "424242");
    assert.equal(rows.rows[0].active, true);
  });

  await t.test("version conflict devuelve 409 y registra el intento fallido en governance.command_attempts", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "test-version-conflict" },
        body: JSON.stringify({ aliasValue: `${ALIAS_PREFIX}5`, aliasType: "RAW", dolibarrProductId: 999, reason: "stale version", expectedVersion: 999 })
      })
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "VERSION_CONFLICT");

    const attempts = await adminPool.query(
      "SELECT error_code FROM governance.command_attempts WHERE command_type = 'correction:part-alias' AND error_code = 'VERSION_CONFLICT' ORDER BY id DESC LIMIT 1"
    );
    assert.equal(attempts.rows.length, 1);
  });
});
