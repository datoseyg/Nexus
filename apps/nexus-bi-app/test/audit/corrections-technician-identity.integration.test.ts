// Pruebas de integración de Gate B - tercer comando de corrección
// (POST /api/audit/corrections/technician-identity). A diferencia de
// alias/ticket-link, este comando NUNCA crea verification_request (B81) -
// la respuesta siempre trae verification="NOT_APPLICABLE" y ningún evento de
// verificación se emite. Cubre también la reversión genérica
// (fn_reverse_correction) desactivando la identidad promovida.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-corrections-technician-identity-gate-b-test";

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

const SOURCE_VALUE = "test-technician-family2";
// Fixture separado para el caso "gerencia también puede" (capacidades
// unificadas, sql/100) - nunca comparte SOURCE_VALUE con administracion:
// varios asserts más abajo (versions.rows.length===2, expectedVersion:1,
// versions.rows[0]/[1] por posición) asumen que administracion es la
// ÚNICA autora de ese target y romperían si gerencia versionara primero.
const GERENCIA_SOURCE_VALUE = "test-technician-family2-gerencia";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), init);
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return {
        user: { id: "55555555-5555-5555-5555-555555555555", app_metadata: { nexus_role: "administracion" } },
        error: null
      };
    }
  });
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "66666666-6666-6666-6666-666666666666", app_metadata: { nexus_role: "gerencia" } }, error: null };
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

  await adminPool.query(`DELETE FROM manual_review.fieldbeat_engineer_identity_map WHERE source_value_normalized = ANY($1)`, [[SOURCE_VALUE, GERENCIA_SOURCE_VALUE]]);
  await adminPool.query(`DELETE FROM governance.correction_targets WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = ANY($1)`, [[SOURCE_VALUE, GERENCIA_SOURCE_VALUE]]);
  await adminPool.query(`DELETE FROM governance.correction_versions WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = ANY($1)`, [[SOURCE_VALUE, GERENCIA_SOURCE_VALUE]]);
  await adminPool.query(`DELETE FROM governance.idempotency_keys WHERE command_type IN ('correction:technician-identity','correction:reverse') AND idempotency_key LIKE 'ti-test-%'`);
  await adminPool.query(`DELETE FROM governance.command_attempts WHERE command_type = 'correction:technician-identity'`);
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`DELETE FROM manual_review.fieldbeat_engineer_identity_map WHERE source_value_normalized = ANY($1)`, [[SOURCE_VALUE, GERENCIA_SOURCE_VALUE]]);
  await adminPool.query(`DELETE FROM governance.correction_targets WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = ANY($1)`, [[SOURCE_VALUE, GERENCIA_SOURCE_VALUE]]);
  await adminPool.query(`DELETE FROM governance.correction_versions WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = ANY($1)`, [[SOURCE_VALUE, GERENCIA_SOURCE_VALUE]]);
  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("POST /api/audit/corrections/technician-identity - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/corrections/technician-identity/route.ts");

  await t.test("rechaza sin header Origin (403 FORBIDDEN)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "ti-test-no-origin" },
        body: JSON.stringify({
          sourceType: "ASSIGNED_TO_USERNAME",
          sourceValueNormalized: SOURCE_VALUE,
          canonicalPersonKey: "test.technician",
          canonicalDisplayName: "TEST TECHNICIAN",
          reason: "x"
        })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("gerencia también puede aplicar la corrección - 200 APPLIED (capacidades unificadas, sql/100)", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ti-test-gerencia" },
        body: JSON.stringify({
          sourceType: "ASSIGNED_TO_USERNAME",
          sourceValueNormalized: GERENCIA_SOURCE_VALUE,
          canonicalPersonKey: "test.technician.gerencia",
          canonicalDisplayName: "TEST TECHNICIAN GERENCIA",
          reason: "gerencia ahora tiene correction:technician-identity"
        })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");
    assert.equal(body.verification, "NOT_APPLICABLE");
  });

  await t.test("rechaza sourceType inválido (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ti-test-bad-source-type" },
        body: JSON.stringify({
          sourceType: "BOGUS_TYPE",
          sourceValueNormalized: SOURCE_VALUE,
          canonicalPersonKey: "test.technician",
          canonicalDisplayName: "TEST TECHNICIAN",
          reason: "x"
        })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("rechaza sin reason (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ti-test-no-reason" },
        body: JSON.stringify({
          sourceType: "ASSIGNED_TO_USERNAME",
          sourceValueNormalized: SOURCE_VALUE,
          canonicalPersonKey: "test.technician",
          canonicalDisplayName: "TEST TECHNICIAN"
        })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("happy path -> 200 APPLIED, verification NOT_APPLICABLE, nunca crea verification_request, replay en la segunda llamada", async () => {
    asAdministracion();
    const idempotencyKey = "ti-test-happy-path";
    const requestInit = {
      method: "POST" as const,
      headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        sourceType: "ASSIGNED_TO_USERNAME",
        sourceValueNormalized: SOURCE_VALUE,
        canonicalPersonKey: "test.technician",
        canonicalDisplayName: "TEST TECHNICIAN",
        reason: "integration test - identidad confirmada manualmente"
      })
    };

    const firstResponse = await POST(req("/api/audit/corrections/technician-identity", requestInit));
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.result, "APPLIED");
    assert.equal(firstBody.replay, false);
    assert.equal(firstBody.verification, "NOT_APPLICABLE");
    assert.equal(firstBody.verificationRequestId, null);

    const secondResponse = await POST(req("/api/audit/corrections/technician-identity", requestInit));
    const secondBody = await secondResponse.json();
    assert.equal(secondBody.replay, true);
    assert.equal(secondBody.correctionVersionId, firstBody.correctionVersionId);

    const identityRow = await adminPool.query(
      "SELECT canonical_person_key, canonical_display_name, verification_method, confidence, is_active FROM manual_review.fieldbeat_engineer_identity_map WHERE source_value_normalized = $1",
      [SOURCE_VALUE]
    );
    assert.equal(identityRow.rows[0].verification_method, "MANUALLY_VERIFIED");
    assert.equal(identityRow.rows[0].confidence, "HIGH");
    assert.equal(identityRow.rows[0].is_active, true);

    const verificationRequests = await adminPool.query(
      "SELECT count(*) AS n FROM governance.verification_requests WHERE correlation_id = $1",
      [firstBody.commandId]
    );
    assert.equal(Number(verificationRequests.rows[0].n), 0, "identidad de técnico nunca crea verification_request");
  });

  await t.test("segunda corrección real (body distinto, versión correcta) -> versiona en vez de sobrescribir silenciosamente", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ti-test-second-real-correction" },
        body: JSON.stringify({
          sourceType: "ASSIGNED_TO_USERNAME",
          sourceValueNormalized: SOURCE_VALUE,
          canonicalPersonKey: "test.technician.corrected",
          canonicalDisplayName: "TEST TECHNICIAN CORRECTED",
          reason: "corrigiendo el nombre canónico",
          expectedVersion: 1
        })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");

    const versions = await adminPool.query(
      "SELECT version, payload FROM governance.correction_versions WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = $1 ORDER BY version",
      [SOURCE_VALUE]
    );
    assert.equal(versions.rows.length, 2, "ambas versiones deben conservarse, nunca sobrescritas");
    assert.equal(versions.rows[0].payload.canonicalDisplayName, "TEST TECHNICIAN");
    assert.equal(versions.rows[1].payload.canonicalDisplayName, "TEST TECHNICIAN CORRECTED");

    const identityRow = await adminPool.query(
      "SELECT canonical_display_name FROM manual_review.fieldbeat_engineer_identity_map WHERE source_value_normalized = $1",
      [SOURCE_VALUE]
    );
    assert.equal(identityRow.rows[0].canonical_display_name, "TEST TECHNICIAN CORRECTED");
  });

  await t.test("version conflict devuelve 409 y registra el intento en governance.command_attempts", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ti-test-version-conflict" },
        body: JSON.stringify({
          sourceType: "ASSIGNED_TO_USERNAME",
          sourceValueNormalized: SOURCE_VALUE,
          canonicalPersonKey: "test.technician",
          canonicalDisplayName: "STALE ATTEMPT",
          reason: "stale version",
          expectedVersion: 999
        })
      })
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "VERSION_CONFLICT");

    const attempts = await adminPool.query(
      "SELECT error_code FROM governance.command_attempts WHERE command_type = 'correction:technician-identity' AND error_code = 'VERSION_CONFLICT' ORDER BY id DESC LIMIT 1"
    );
    assert.equal(attempts.rows.length, 1);
  });

  await t.test("reversión (fn_reverse_correction) desactiva la identidad promovida, conserva el historial", async () => {
    const currentTarget = await adminPool.query(
      "SELECT current_correction_version_id, current_version FROM governance.correction_targets WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = $1",
      [SOURCE_VALUE]
    );
    const correctionVersionId = currentTarget.rows[0].current_correction_version_id;

    const result = await adminPool.query(
      "SELECT governance.fn_reverse_correction($1::uuid, 'administracion', $2, 'reversión de prueba', 'ti-test-reversal', gen_random_uuid()) AS result",
      ["55555555-5555-5555-5555-555555555555", correctionVersionId]
    );
    assert.equal(result.rows[0].result.result, "APPLIED");

    const identityRow = await adminPool.query(
      "SELECT is_active FROM manual_review.fieldbeat_engineer_identity_map WHERE source_value_normalized = $1",
      [SOURCE_VALUE]
    );
    assert.equal(identityRow.rows[0].is_active, false);

    const versions = await adminPool.query(
      "SELECT count(*) AS n FROM governance.correction_versions WHERE target_type = 'TECHNICIAN_IDENTITY' AND target_key->>'sourceValueNormalized' = $1",
      [SOURCE_VALUE]
    );
    assert.equal(Number(versions.rows[0].n), 3, "la reversión agrega una versión nueva, nunca borra las anteriores");
  });
});
