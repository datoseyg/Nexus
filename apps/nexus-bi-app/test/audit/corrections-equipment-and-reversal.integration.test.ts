// Pruebas de integración de Gate B - Familia 5: identificación de equipo
// (correction:equipment-identification) y reversión GENÉRICA de una
// corrección (correction:reverse). Invariantes cubiertas: sin regla de
// calidad asociada en v1 -> verification="NOT_APPLICABLE", nunca crea
// verification_request; solo se puede revertir la versión VIGENTE de un
// target; la reversión nunca borra el historial (correction_versions
// conserva ambas filas, la original queda superseded_by); Gerencia 403 en
// ambos comandos.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-equipment-and-reversal-gate-b-test";

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

const FIELDBEAT_TASK_ID = 975401;
const RAW_EQUIPMENT_REFERENCE = "equipment-test-raw-975401";
const ADMIN_ACTOR_ID = "77777777-7777-7777-7777-777777777777";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), init);
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

  await adminPool.query(`DELETE FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $1`, [FIELDBEAT_TASK_ID]);
  // correction_targets.current_correction_version_id -> correction_versions.id:
  // borrar correction_targets ANTES de correction_versions, nunca al revés.
  await adminPool.query(
    `DELETE FROM governance.correction_targets WHERE target_type = 'EQUIPMENT_IDENTIFICATION' AND target_key->>'fieldbeatTaskId' = $1`,
    [String(FIELDBEAT_TASK_ID)]
  );
  await adminPool.query(
    `DELETE FROM governance.correction_versions WHERE target_type = 'EQUIPMENT_IDENTIFICATION' AND target_key->>'fieldbeatTaskId' = $1`,
    [String(FIELDBEAT_TASK_ID)]
  );
});

afterAll(async () => {
  if (!TEST_DB_URL) return;

  await adminPool.query(
    `DELETE FROM governance.command_events WHERE command_type IN ('correction:equipment-identification','correction:reverse')
       AND actor_user_id = $1 AND after_state->>'equipmentOverrideId' IN (
         SELECT id::text FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $2
       )`,
    [ADMIN_ACTOR_ID, FIELDBEAT_TASK_ID]
  );
  // El evento de reversión referencia correctionVersionId, no equipmentOverrideId -
  // se limpia por separado vía el correction_type conocido.
  await adminPool.query(
    `DELETE FROM governance.command_events WHERE command_type = 'correction:reverse' AND actor_user_id = $1
       AND after_state->>'reversedCorrectionVersionId' IN (
         SELECT id::text FROM governance.correction_versions WHERE target_type = 'EQUIPMENT_IDENTIFICATION' AND target_key->>'fieldbeatTaskId' = $2
       )`,
    [ADMIN_ACTOR_ID, String(FIELDBEAT_TASK_ID)]
  );
  await adminPool.query(`DELETE FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $1`, [FIELDBEAT_TASK_ID]);
  // Mismo orden que en before(): correction_targets antes que correction_versions.
  await adminPool.query(
    `DELETE FROM governance.correction_targets WHERE target_type = 'EQUIPMENT_IDENTIFICATION' AND target_key->>'fieldbeatTaskId' = $1`,
    [String(FIELDBEAT_TASK_ID)]
  );
  await adminPool.query(
    `DELETE FROM governance.correction_versions WHERE target_type = 'EQUIPMENT_IDENTIFICATION' AND target_key->>'fieldbeatTaskId' = $1`,
    [String(FIELDBEAT_TASK_ID)]
  );
  await adminPool.query(`DELETE FROM governance.idempotency_keys WHERE idempotency_key LIKE 'eq-test-%' OR idempotency_key LIKE 'rev-test-%'`);
  await adminPool.query(`DELETE FROM governance.command_attempts WHERE command_type IN ('correction:equipment-identification','correction:reverse') AND actor_user_id = $1`, [ADMIN_ACTOR_ID]);

  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

let firstCorrectionVersionId: number;

test("POST /api/audit/corrections/equipment-identification - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/corrections/equipment-identification/route.ts");

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "eq-test-gerencia" },
        body: JSON.stringify({ fieldbeatTaskId: FIELDBEAT_TASK_ID, correctedEquipmentInternalId: "EQ-900", reason: "x" })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("rechaza sin correctedEquipmentInternalId (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "eq-test-no-corrected-id" },
        body: JSON.stringify({ fieldbeatTaskId: FIELDBEAT_TASK_ID, reason: "x" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "eq-test-no-reason" },
        body: JSON.stringify({ fieldbeatTaskId: FIELDBEAT_TASK_ID, correctedEquipmentInternalId: "EQ-900" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("aplica la corrección - verification=NOT_APPLICABLE, cero verification_requests (sin regla asociada en v1)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "eq-test-happy" },
        body: JSON.stringify({
          fieldbeatTaskId: FIELDBEAT_TASK_ID,
          rawEquipmentReference: RAW_EQUIPMENT_REFERENCE,
          correctedEquipmentInternalId: "EQ-900",
          reason: "identificación estructurada corregida manualmente"
        })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");
    assert.equal(body.verification, "NOT_APPLICABLE");
    assert.equal(body.verificationRequestId, null);
    assert.ok(body.correctionVersionId);
    firstCorrectionVersionId = body.correctionVersionId;

    const override = await adminPool.query(
      `SELECT corrected_equipment_internal_id, active FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $1 AND raw_equipment_reference = $2`,
      [FIELDBEAT_TASK_ID, RAW_EQUIPMENT_REFERENCE]
    );
    assert.equal(override.rows[0].corrected_equipment_internal_id, "EQ-900");
    assert.equal(override.rows[0].active, true);
  });

  await t.test("replay: mismo Idempotency-Key + mismo body -> misma respuesta, sin doble escritura", async () => {
    asAdministracion();
    const before = await adminPool.query(`SELECT count(*) AS n FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $1`, [FIELDBEAT_TASK_ID]);

    const response = await POST(
      req("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "eq-test-happy" },
        body: JSON.stringify({
          fieldbeatTaskId: FIELDBEAT_TASK_ID,
          rawEquipmentReference: RAW_EQUIPMENT_REFERENCE,
          correctedEquipmentInternalId: "EQ-900",
          reason: "identificación estructurada corregida manualmente"
        })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.replay, true);
    assert.equal(body.correctionVersionId, firstCorrectionVersionId);

    const after = await adminPool.query(`SELECT count(*) AS n FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $1`, [FIELDBEAT_TASK_ID]);
    assert.equal(after.rows[0].n, before.rows[0].n, "un replay nunca vuelve a escribir");
  });

  await t.test("misma Idempotency-Key con body distinto -> 409 IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "eq-test-happy" },
        body: JSON.stringify({
          fieldbeatTaskId: FIELDBEAT_TASK_ID,
          rawEquipmentReference: RAW_EQUIPMENT_REFERENCE,
          correctedEquipmentInternalId: "EQ-999-DIFERENTE",
          reason: "identificación estructurada corregida manualmente"
        })
      })
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY");
  });
});

test("POST /api/audit/corrections/reverse - integración (genérica)", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/corrections/reverse/route.ts");

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/corrections/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rev-test-gerencia" },
        body: JSON.stringify({ correctionVersionId: firstCorrectionVersionId, reason: "x" })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rev-test-no-reason" },
        body: JSON.stringify({ correctionVersionId: firstCorrectionVersionId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("rechaza revertir un correction_version_id inexistente (404 NOT_FOUND)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rev-test-not-found" },
        body: JSON.stringify({ correctionVersionId: 999999999, reason: "no existe" })
      })
    );
    assert.equal(response.status, 404);
  });

  await t.test("revierte la corrección vigente - nueva versión, overlay desactivado, historial conservado (nunca se borra la versión original)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rev-test-happy" },
        body: JSON.stringify({ correctionVersionId: firstCorrectionVersionId, reason: "el equipo correcto era otro, se revierte esta corrección" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");
    assert.equal(body.verification, "NOT_APPLICABLE", "equipment-identification no tiene regla asociada en v1 (B81)");
    assert.ok(body.correctionVersionId);
    assert.notEqual(body.correctionVersionId, firstCorrectionVersionId);

    const override = await adminPool.query(
      `SELECT active FROM manual_review.equipment_identification_overrides WHERE fieldbeat_task_id = $1 AND raw_equipment_reference = $2`,
      [FIELDBEAT_TASK_ID, RAW_EQUIPMENT_REFERENCE]
    );
    assert.equal(override.rows[0].active, false, "la reversión desactiva la fila efectiva");

    const original = await adminPool.query(`SELECT superseded_by FROM governance.correction_versions WHERE id = $1`, [firstCorrectionVersionId]);
    assert.equal(String(original.rows[0].superseded_by), String(body.correctionVersionId), "la versión original nunca se borra, solo queda superseded_by");

    const reversalRow = await adminPool.query(`SELECT reversal_of, correction_type FROM governance.correction_versions WHERE id = $1`, [body.correctionVersionId]);
    assert.equal(String(reversalRow.rows[0].reversal_of), String(firstCorrectionVersionId));
    assert.equal(reversalRow.rows[0].correction_type, "equipment-identification");
  });

  await t.test("rechaza revertir una versión ya superada (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rev-test-already-superseded" },
        body: JSON.stringify({ correctionVersionId: firstCorrectionVersionId, reason: "intento inválido sobre una versión ya superada" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });
});
