// Pruebas de integración de Gate B - ciclo de vida de incidencias (Familia
// 3): iniciar revisión, descartar con razón, reabrir. Invariantes cubiertas:
// DISMISSED exige razón; descartar NO significa que la regla deje de
// detectar (is_currently_detected se conserva); reabrir deja el issue en
// IN_REVIEW (nunca RESOLVED); optimistic concurrency; Gerencia read-only.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-issue-lifecycle-gate-b-test";

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
let issueOpenId: number;
let issueForReopenId: number;

const ENTITY_KEY_A = "lifecycle-test-975101";
const ENTITY_KEY_B = "lifecycle-test-975102";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), init);
}

function asAdministracion() {
  setAuthorizationProviderForTests({
    async getUser() {
      return {
        user: { id: "77777777-7777-7777-7777-777777777777", app_metadata: { nexus_role: "administracion" } },
        error: null
      };
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

async function insertOpenIssue(entityKey: string, fingerprint: string): Promise<number> {
  const result = await adminPool.query(
    `INSERT INTO governance.issues
      (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
       severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
     VALUES ($1, 'PART_NO_MATCH', 1, 1, 'part_occurrence', $2, $2, 'MEDIUM', 'OPEN', now(), now(), now(), true)
     RETURNING id`,
    [fingerprint, entityKey]
  );
  return Number(result.rows[0].id);
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM governance.issues WHERE entity_key IN ($1, $2)`, [ENTITY_KEY_A, ENTITY_KEY_B]);

  issueOpenId = await insertOpenIssue(ENTITY_KEY_A, "lifecycle-test-fingerprint-a");
  issueForReopenId = await insertOpenIssue(ENTITY_KEY_B, "lifecycle-test-fingerprint-b");
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`DELETE FROM governance.command_events WHERE issue_id IN ($1, $2)`, [issueOpenId, issueForReopenId]);
  await adminPool.query(`UPDATE governance.issues SET status='OPEN', resolution_type=NULL, resolved_rule_version=NULL,
      resolution_evaluation_run_id=NULL, resolution_evidence_id=NULL, resolution_triggered_by_correlation_id=NULL,
      dismissed_by_actor_id=NULL, closed_at=NULL, closed_reason=NULL, is_currently_detected=true, disappeared_at=NULL
    WHERE id IN ($1, $2)`, [issueOpenId, issueForReopenId]);
  await adminPool.query(`DELETE FROM governance.issues WHERE id IN ($1, $2)`, [issueOpenId, issueForReopenId]);
  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("POST /api/audit/issues/start-review - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/issues/start-review/route.ts");

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/issues/start-review", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "sr-test-gerencia" },
        body: JSON.stringify({ issueId: issueOpenId })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("administracion: OPEN -> IN_REVIEW, razón opcional", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/issues/start-review", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "sr-test-happy" },
        body: JSON.stringify({ issueId: issueOpenId, expectedVersion: 1 })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "IN_REVIEW");

    const row = await adminPool.query("SELECT status, version FROM governance.issues WHERE id = $1", [issueOpenId]);
    assert.equal(row.rows[0].status, "IN_REVIEW");
    assert.equal(row.rows[0].version, 2);
  });

  await t.test("rechaza iniciar revisión sobre un issue que ya no está OPEN (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/issues/start-review", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "sr-test-not-open" },
        body: JSON.stringify({ issueId: issueOpenId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });
});

test("POST /api/audit/issues/dismiss - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/issues/dismiss/route.ts");

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/issues/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dm-test-gerencia" },
        body: JSON.stringify({ issueId: issueOpenId, reason: "x" })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED) - DISMISSED exige razón", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/issues/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dm-test-no-reason" },
        body: JSON.stringify({ issueId: issueOpenId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("descarta con razón -> DISMISSED, is_currently_detected se conserva (descartar no es 'la regla dejó de detectar')", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/issues/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dm-test-happy" },
        body: JSON.stringify({ issueId: issueOpenId, reason: "falso positivo confirmado manualmente", expectedVersion: 2 })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "DISMISSED");

    const row = await adminPool.query(
      "SELECT status, resolution_type, dismissed_by_actor_id, closed_reason, closed_at, is_currently_detected FROM governance.issues WHERE id = $1",
      [issueOpenId]
    );
    assert.equal(row.rows[0].status, "DISMISSED");
    assert.equal(row.rows[0].resolution_type, "DISMISSED");
    assert.ok(row.rows[0].dismissed_by_actor_id);
    assert.equal(row.rows[0].closed_reason, "falso positivo confirmado manualmente");
    assert.ok(row.rows[0].closed_at);
    assert.equal(row.rows[0].is_currently_detected, true, "descartar NUNCA cambia is_currently_detected - la regla puede seguir detectando el problema");
  });

  await t.test("version conflict devuelve 409 y registra el intento", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/issues/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "dm-test-version-conflict" },
        body: JSON.stringify({ issueId: issueForReopenId, reason: "stale version", expectedVersion: 999 })
      })
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "VERSION_CONFLICT");

    const attempts = await adminPool.query(
      "SELECT error_code FROM governance.command_attempts WHERE command_type = 'issue:dismiss' AND error_code = 'VERSION_CONFLICT' ORDER BY id DESC LIMIT 1"
    );
    assert.equal(attempts.rows.length, 1);
  });
});

test("POST /api/audit/issues/reopen - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST: dismissPost } = await import("../../app/api/audit/issues/dismiss/route.ts");
  const { POST: reopenPost } = await import("../../app/api/audit/issues/reopen/route.ts");

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await reopenPost(
      req("/api/audit/issues/reopen", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ro-test-gerencia" },
        body: JSON.stringify({ issueId: issueForReopenId, reason: "x" })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await reopenPost(
      req("/api/audit/issues/reopen", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ro-test-no-reason" },
        body: JSON.stringify({ issueId: issueForReopenId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("reabre un issue descartado -> IN_REVIEW (nunca RESOLVED), sin verificación inmediata", async () => {
    asAdministracion();
    const dismissResponse = await dismissPost(
      req("/api/audit/issues/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ro-test-setup-dismiss" },
        body: JSON.stringify({ issueId: issueForReopenId, reason: "preparando prueba de reapertura", expectedVersion: 1 })
      })
    );
    assert.equal(dismissResponse.status, 200);

    const reopenResponse = await reopenPost(
      req("/api/audit/issues/reopen", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "ro-test-happy" },
        body: JSON.stringify({ issueId: issueForReopenId, reason: "reconsiderado - sí requiere corrección", expectedVersion: 2 })
      })
    );
    assert.equal(reopenResponse.status, 200);
    const body = await reopenResponse.json();
    assert.equal(body.status, "IN_REVIEW", "reabrir deja el issue en IN_REVIEW, nunca en RESOLVED");

    const row = await adminPool.query(
      "SELECT status, resolution_type, closed_at, dismissed_by_actor_id FROM governance.issues WHERE id = $1",
      [issueForReopenId]
    );
    assert.equal(row.rows[0].status, "IN_REVIEW");
    assert.equal(row.rows[0].resolution_type, null);
    assert.equal(row.rows[0].closed_at, null);
    assert.equal(row.rows[0].dismissed_by_actor_id, null);

    const verificationRequests = await adminPool.query(
      "SELECT count(*) AS n FROM governance.verification_requests WHERE issue_id = $1",
      [issueForReopenId]
    );
    assert.equal(Number(verificationRequests.rows[0].n), 0, "reabrir nunca dispara una verificación SCOPED inmediata");
  });
});
