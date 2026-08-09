// Pruebas de integración de Gate B - segundo comando de corrección
// (POST /api/audit/corrections/ticket-link) contra un Postgres 16 real y
// DESECHABLE - mismo mecanismo que corrections-part-alias.integration.test.ts.
// Cubre el ciclo completo: comando HTTP -> issue vía ejecutor de reglas ->
// verification_request -> outbox (claim/complete) -> PASSED/STILL_DETECTED,
// además de idempotencia, conflicto de versión, y autorización.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-corrections-ticket-link-gate-b-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const GOVERNANCE_ENV_VARS = [
  "GOVERNANCE_APP_READ_DB_URL",
  "GOVERNANCE_APP_CORRECTIONS_DB_URL",
  "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL",
  "GOVERNANCE_RULE_EVALUATOR_DB_URL"
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
let evaluatorPool: pg.Pool;

const TASK_ID_A = 975001; // CORRECTED -> PASSED
const TASK_ID_B = 975002; // CONFIRMED_NO_TICKET -> PASSED
const TASK_ID_C = 975003; // STILL_DETECTED (override revertido antes de verificar)
const TASK_ID_D = 975004; // idempotencia/version-conflict, nunca llega a verificación
const TASK_ID_GERENCIA = 975005; // gerencia también puede (capacidades unificadas, sql/100) - fixture propio, nunca comparte con TASK_ID_A
const CLIENT_NAME = "TICKETLINK_TEST_CLIENT";

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

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "44444444-4444-4444-4444-444444444444", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

async function insertTaskFixture(taskId: number) {
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
      (fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, zendesk_join_status, linked_zendesk_ticket_id, used_parts_count)
     VALUES ($1, now(), $2, 'PM', 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK', '999999', 0)`,
    [taskId, CLIENT_NAME]
  );
}

async function runScopedEvaluation(taskId: number): Promise<string> {
  const result = await evaluatorPool.query(
    "SELECT governance.fn_run_rule_evaluation('SCOPED', 'TICKET_LINK_RESTRICTED_OR_MISSING', $1, $1, 'MANUAL_ADMIN') AS run_id",
    [String(taskId)]
  );
  return result.rows[0].run_id;
}

async function getIssueForTask(taskId: number) {
  const result = await adminPool.query(
    "SELECT id, status, is_currently_detected FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key = $1",
    [String(taskId)]
  );
  return result.rows[0] as { id: number; status: string; is_currently_detected: boolean } | undefined;
}

async function claimAndComplete(serviceKey: string) {
  const claim = await evaluatorPool.query("SELECT * FROM governance.fn_claim_verification_requests($1, 5, 60)", [serviceKey]);
  const results = [];
  for (const row of claim.rows) {
    const completed = await evaluatorPool.query(
      "SELECT governance.fn_complete_verification_request($1, $2, $3::uuid) AS result",
      [serviceKey, row.request_id, row.claim_token]
    );
    results.push({ requestId: row.request_id, issueId: row.issue_id, result: completed.rows[0].result });
  }
  return results;
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  evaluatorPool = new Pool({ connectionString: process.env.GOVERNANCE_RULE_EVALUATOR_DB_URL });

  await adminPool.query(`UPDATE governance.issues SET status = 'OPEN', resolution_type = NULL, resolved_rule_version = NULL,
      resolution_evaluation_run_id = NULL, resolution_evidence_id = NULL, resolution_triggered_by_correlation_id = NULL,
      dismissed_by_actor_id = NULL, closed_at = NULL, closed_reason = NULL, is_currently_detected = true, disappeared_at = NULL
    WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM governance.command_events WHERE issue_id IN (SELECT id FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005'))`);
  await adminPool.query(`DELETE FROM governance.verification_requests WHERE issue_id IN (SELECT id FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005'))`);
  await adminPool.query(`DELETE FROM governance.issue_evidence WHERE issue_id IN (SELECT id FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005'))`);
  await adminPool.query(`DELETE FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN 975001 AND 975099`);
  await adminPool.query(`DELETE FROM manual_review.ticket_link_overrides WHERE fieldbeat_task_id BETWEEN 975001 AND 975099`);
  await adminPool.query(`DELETE FROM governance.correction_targets WHERE target_type = 'TICKET_LINK' AND target_key->>'fieldbeatTaskId' IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM governance.correction_versions WHERE target_type = 'TICKET_LINK' AND target_key->>'fieldbeatTaskId' IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM governance.idempotency_keys WHERE command_type = 'correction:ticket-link' AND idempotency_key LIKE 'tl-test-%'`);
  await adminPool.query(`DELETE FROM governance.command_attempts WHERE command_type = 'correction:ticket-link'`);

  await insertTaskFixture(TASK_ID_A);
  await insertTaskFixture(TASK_ID_B);
  await insertTaskFixture(TASK_ID_C);
  await insertTaskFixture(TASK_ID_D);
  await insertTaskFixture(TASK_ID_GERENCIA);

  for (const id of [TASK_ID_A, TASK_ID_B, TASK_ID_C, TASK_ID_D, TASK_ID_GERENCIA]) {
    await runScopedEvaluation(id);
  }
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`UPDATE governance.issues SET status = 'OPEN', resolution_type = NULL, resolved_rule_version = NULL,
      resolution_evaluation_run_id = NULL, resolution_evidence_id = NULL, resolution_triggered_by_correlation_id = NULL,
      dismissed_by_actor_id = NULL, closed_at = NULL, closed_reason = NULL, is_currently_detected = true, disappeared_at = NULL
    WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM governance.command_events WHERE issue_id IN (SELECT id FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005'))`);
  await adminPool.query(`DELETE FROM governance.verification_requests WHERE issue_id IN (SELECT id FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005'))`);
  await adminPool.query(`DELETE FROM governance.issue_evidence WHERE issue_id IN (SELECT id FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005'))`);
  await adminPool.query(`DELETE FROM governance.issues WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND entity_key IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN 975001 AND 975099`);
  await adminPool.query(`DELETE FROM manual_review.ticket_link_overrides WHERE fieldbeat_task_id BETWEEN 975001 AND 975099`);
  await adminPool.query(`DELETE FROM governance.correction_targets WHERE target_type = 'TICKET_LINK' AND target_key->>'fieldbeatTaskId' IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM governance.correction_versions WHERE target_type = 'TICKET_LINK' AND target_key->>'fieldbeatTaskId' IN ('975001','975002','975003','975004','975005')`);
  await adminPool.query(`DELETE FROM governance.idempotency_keys WHERE command_type = 'correction:ticket-link' AND idempotency_key LIKE 'tl-test-%'`);
  await adminPool.query(`DELETE FROM governance.command_attempts WHERE command_type = 'correction:ticket-link'`);
  await adminPool.end();
  await evaluatorPool.end();
  setAuthorizationProviderForTests(null);
});

test("POST /api/audit/corrections/ticket-link - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/corrections/ticket-link/route.ts");

  await t.test("rechaza sin header Origin (403 FORBIDDEN)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "tl-test-no-origin" },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_A, overrideType: "CORRECTED", correctedZendeskTicketId: 12345, reason: "x" })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("gerencia también puede aplicar la corrección - 200 APPLIED (capacidades unificadas, sql/100)", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "tl-test-gerencia" },
        body: JSON.stringify({
          fieldbeatTaskId: TASK_ID_GERENCIA,
          overrideType: "CORRECTED",
          correctedZendeskTicketId: 12345,
          reason: "gerencia ahora tiene correction:ticket-link"
        })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");
  });

  await t.test("rechaza CORRECTED sin correctedZendeskTicketId (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "tl-test-missing-ticket-id" },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_A, overrideType: "CORRECTED", reason: "x" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("rechaza sin reason (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "tl-test-no-reason" },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_A, overrideType: "CONFIRMED_NO_TICKET" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("CORRECTED con Origin+Idempotency-Key+reason -> 200 APPLIED, verification PENDING, replay en la segunda llamada", async () => {
    asAdministracion();
    const idempotencyKey = "tl-test-corrected-happy-path";
    const requestInit = {
      method: "POST" as const,
      headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        fieldbeatTaskId: TASK_ID_A,
        overrideType: "CORRECTED",
        correctedZendeskTicketId: 555001,
        reason: "integration test - ticket correcto identificado"
      })
    };

    const firstResponse = await POST(req("/api/audit/corrections/ticket-link", requestInit));
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.result, "APPLIED");
    assert.equal(firstBody.replay, false);
    assert.equal(firstBody.verification, "PENDING");
    assert.ok(firstBody.verificationRequestId);

    const secondResponse = await POST(req("/api/audit/corrections/ticket-link", requestInit));
    const secondBody = await secondResponse.json();
    assert.equal(secondBody.replay, true);
    assert.equal(secondBody.correctionVersionId, firstBody.correctionVersionId);

    const override = await adminPool.query("SELECT override_type, corrected_zendesk_ticket_id FROM manual_review.ticket_link_overrides WHERE fieldbeat_task_id = $1", [TASK_ID_A]);
    assert.equal(override.rows[0].override_type, "CORRECTED");
    assert.equal(override.rows[0].corrected_zendesk_ticket_id, "555001");
  });

  await t.test("CORRECTED -> outbox claim/complete -> PASSED, issue RESOLVED/VERIFIED", async () => {
    const results = await claimAndComplete("test-worker-ticket-link-a");
    assert.ok(results.length > 0, "debe haber al menos una solicitud reclamada");

    const issue = await getIssueForTask(TASK_ID_A);
    assert.ok(issue);
    assert.equal(issue!.status, "RESOLVED");
    assert.equal(issue!.is_currently_detected, false);

    const fullIssueRow = await adminPool.query(
      "SELECT resolution_type, resolution_evidence_id, closed_at FROM governance.issues WHERE id = $1",
      [issue!.id]
    );
    assert.equal(fullIssueRow.rows[0].resolution_type, "VERIFIED");
    assert.ok(fullIssueRow.rows[0].resolution_evidence_id);
    assert.ok(fullIssueRow.rows[0].closed_at);
  });

  await t.test("CONFIRMED_NO_TICKET -> 200 APPLIED -> outbox -> PASSED", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "tl-test-confirmed-no-ticket" },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_B, overrideType: "CONFIRMED_NO_TICKET", reason: "confirmado: visita sin ticket real" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");
    assert.equal(body.verification, "PENDING");

    await claimAndComplete("test-worker-ticket-link-b");
    const issue = await getIssueForTask(TASK_ID_B);
    assert.equal(issue!.status, "RESOLVED");
  });

  await t.test("STILL_DETECTED: corrección aplicada pero revertida antes de verificar -> issue permanece IN_REVIEW", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "tl-test-still-detected" },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_C, overrideType: "DUPLICATE", correctedZendeskTicketId: 555003, reason: "marcado como duplicado (test)" })
      })
    );
    assert.equal(response.status, 200);

    // Simula que la corrección se revirtió antes de que el worker verificara
    // (condición de carrera real posible: alguien más deshace el override) -
    // la verificación NUNCA debe confiar ciegamente en que el comando tuvo
    // éxito, debe reevaluar la regla de verdad.
    await adminPool.query("DELETE FROM manual_review.ticket_link_overrides WHERE fieldbeat_task_id = $1", [TASK_ID_C]);

    await claimAndComplete("test-worker-ticket-link-c");
    const issue = await getIssueForTask(TASK_ID_C);
    assert.ok(issue);
    assert.equal(issue!.status, "IN_REVIEW", "el issue nunca debe resolverse si la regla sigue detectando el problema");
    assert.equal(issue!.is_currently_detected, true);

    const verificationRow = await adminPool.query(
      "SELECT processing_status, verification_outcome FROM governance.verification_requests WHERE issue_id = $1 ORDER BY id DESC LIMIT 1",
      [issue!.id]
    );
    assert.equal(verificationRow.rows[0].processing_status, "COMPLETED");
    assert.equal(verificationRow.rows[0].verification_outcome, "STILL_DETECTED");
  });

  await t.test("version conflict devuelve 409 y registra el intento en governance.command_attempts", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "tl-test-version-conflict" },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_D, overrideType: "CONFIRMED_NO_TICKET", reason: "stale version", expectedVersion: 999 })
      })
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "VERSION_CONFLICT");

    const attempts = await adminPool.query(
      "SELECT error_code FROM governance.command_attempts WHERE command_type = 'correction:ticket-link' AND error_code = 'VERSION_CONFLICT' ORDER BY id DESC LIMIT 1"
    );
    assert.equal(attempts.rows.length, 1);
  });

  await t.test("mismo Idempotency-Key con body distinto -> 409 IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY", async () => {
    asAdministracion();
    const idempotencyKey = "tl-test-reused-key-different-body";
    const first = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_D, overrideType: "CONFIRMED_NO_TICKET", reason: "primer intento" })
      })
    );
    assert.equal(first.status, 200);

    const second = await POST(
      req("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ fieldbeatTaskId: TASK_ID_D, overrideType: "DUPLICATE", correctedZendeskTicketId: 555004, reason: "segundo intento, body distinto" })
      })
    );
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.code, "IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY");
  });
});
