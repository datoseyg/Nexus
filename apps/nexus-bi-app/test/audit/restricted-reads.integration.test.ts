// Pruebas de integración de Gate B - Familia 6: lectura gobernada de
// contenido restringido (evidencia RESTRICTED_STRUCTURED, cuerpo original de
// un comentario redactado, before/after de un evento). Invariantes
// cubiertas: capacidad audit:evidence-restricted (gerencia y administracion
// por igual, sql/100_role_capabilities_unification.sql - gerencia usa su
// propio bundle de fixtures para no duplicar las filas de auditoría que
// administracion cuenta más abajo); razón obligatoria; un objeto por
// request; cada acceso queda registrado como un evento nuevo
// (RESTRICTED_EVIDENCE_ACCESSED/REDACTED_COMMENT_ACCESSED/
// RESTRICTED_EVENT_STATE_ACCESSED); ningún contenido restringido se filtra
// a través de las vistas *_business_safe/current.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-restricted-reads-gate-b-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const GOVERNANCE_ENV_VARS = [
  "GOVERNANCE_APP_READ_DB_URL",
  "GOVERNANCE_APP_CORRECTIONS_DB_URL",
  "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL",
  "GOVERNANCE_AUDIT_RESTRICTED_READ_DB_URL"
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

const ENTITY_KEY = "restricted-test-975501";
// Dedicado a "gerencia también puede" (capacidades unificadas, sql/100) -
// cada lectura restringida crea una fila NUEVA de auditoría
// (RESTRICTED_*_ACCESSED); varios asserts más abajo cuentan
// events.rows.length===1 para el fixture de administracion, que se rompería
// si gerencia leyera el mismo evidenceId/commentId/commandEventId primero.
const ENTITY_KEY_GERENCIA = "restricted-test-975502";
const ADMIN_ACTOR_ID = "77777777-7777-7777-7777-777777777777";
const GERENCIA_ACTOR_ID = "88888888-8888-8888-8888-888888888888";

let issueId: number;
let evaluationRunId: string;
let evidenceId: number;
let reviewCaseId: number;
let redactedCommentId: number;
let commandEventId: number;

let gerenciaIssueId: number;
let gerenciaEvidenceId: number;
let gerenciaReviewCaseId: number;
let gerenciaRedactedCommentId: number;
let gerenciaCommandEventId: number;

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

  await adminPool.query(`DELETE FROM governance.issues WHERE entity_key = $1`, [ENTITY_KEY]);

  const issueResult = await adminPool.query(
    `INSERT INTO governance.issues
      (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
       severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
     VALUES ($1, 'PART_NO_MATCH', 1, 1, 'part_occurrence', $2, $2, 'MEDIUM', 'OPEN', now(), now(), now(), true)
     RETURNING id`,
    ["restricted-test-fingerprint", ENTITY_KEY]
  );
  issueId = Number(issueResult.rows[0].id);

  const runResult = await adminPool.query(
    `INSERT INTO governance.rule_evaluation_runs (rule_set_version, scope_mode, triggered_by) VALUES ('restricted-test-1', 'FULL', 'MANUAL_ADMIN') RETURNING evaluation_run_id`
  );
  evaluationRunId = runResult.rows[0].evaluation_run_id;

  const evidenceResult = await adminPool.query(
    `INSERT INTO governance.issue_evidence
      (issue_id, evaluation_run_id, evidence_type, rule_code, rule_version, source_object, source_record_key,
       rule_inputs, observed_values, evidence_hash, redaction_level, contains_personal_data)
     VALUES ($1, $2, 'RULE_DETECTION', 'PART_NO_MATCH', 1, 'processed.fieldbeat_used_parts', '{"usedPartId": 1}'::jsonb,
       '{"rawPartIdentifier": "RESTRICTED-RAW-VALUE"}'::jsonb, '{"matchStatus": "NO_MATCH"}'::jsonb,
       'restricted-test-hash', 'RESTRICTED_STRUCTURED', true)
     RETURNING id`,
    [issueId, evaluationRunId]
  );
  evidenceId = Number(evidenceResult.rows[0].id);

  const caseResult = await adminPool.query(`INSERT INTO governance.review_cases (status) VALUES ('OPEN') RETURNING id`);
  reviewCaseId = Number(caseResult.rows[0].id);

  const commentResult = await adminPool.query(
    `INSERT INTO governance.review_case_comments (review_case_id, actor_user_id, body, is_redacted, redaction_reason, redacted_by_actor_id, redacted_at)
     VALUES ($1, $2, 'Contenido original sensible que fue redactado', true, 'contenía datos que no correspondía mostrar', $2, now())
     RETURNING id`,
    [reviewCaseId, ADMIN_ACTOR_ID]
  );
  redactedCommentId = Number(commentResult.rows[0].id);

  const eventResult = await adminPool.query(
    `INSERT INTO governance.command_events
      (correlation_id, event_type, command_type, issue_id, actor_type, actor_user_id, actor_role, reason, before_state, after_state, service_actor_key)
     VALUES (gen_random_uuid(), 'ISSUE_ASSIGNED', 'review-case:assign', $1, 'HUMAN', $2, 'administracion', 'fixture', '{"status":"OPEN"}'::jsonb, '{"status":"IN_REVIEW"}'::jsonb, NULL)
     RETURNING id`,
    [issueId, ADMIN_ACTOR_ID]
  );
  commandEventId = Number(eventResult.rows[0].id);

  // Segundo bundle de fixtures completo, dedicado a gerencia (ver comentario
  // en ENTITY_KEY_GERENCIA más arriba) - misma forma exacta que el bundle de
  // administracion de arriba, nunca comparte una fila.
  const gerenciaIssueResult = await adminPool.query(
    `INSERT INTO governance.issues
      (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
       severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
     VALUES ($1, 'PART_NO_MATCH', 1, 1, 'part_occurrence', $2, $2, 'MEDIUM', 'OPEN', now(), now(), now(), true)
     RETURNING id`,
    ["restricted-test-fingerprint-gerencia", ENTITY_KEY_GERENCIA]
  );
  gerenciaIssueId = Number(gerenciaIssueResult.rows[0].id);

  const gerenciaEvidenceResult = await adminPool.query(
    `INSERT INTO governance.issue_evidence
      (issue_id, evaluation_run_id, evidence_type, rule_code, rule_version, source_object, source_record_key,
       rule_inputs, observed_values, evidence_hash, redaction_level, contains_personal_data)
     VALUES ($1, $2, 'RULE_DETECTION', 'PART_NO_MATCH', 1, 'processed.fieldbeat_used_parts', '{"usedPartId": 2}'::jsonb,
       '{"rawPartIdentifier": "RESTRICTED-RAW-VALUE-GERENCIA"}'::jsonb, '{"matchStatus": "NO_MATCH"}'::jsonb,
       'restricted-test-hash-gerencia', 'RESTRICTED_STRUCTURED', true)
     RETURNING id`,
    [gerenciaIssueId, evaluationRunId]
  );
  gerenciaEvidenceId = Number(gerenciaEvidenceResult.rows[0].id);

  const gerenciaCaseResult = await adminPool.query(`INSERT INTO governance.review_cases (status) VALUES ('OPEN') RETURNING id`);
  gerenciaReviewCaseId = Number(gerenciaCaseResult.rows[0].id);

  const gerenciaCommentResult = await adminPool.query(
    `INSERT INTO governance.review_case_comments (review_case_id, actor_user_id, body, is_redacted, redaction_reason, redacted_by_actor_id, redacted_at)
     VALUES ($1, $2, 'Contenido original sensible que fue redactado (gerencia)', true, 'contenía datos que no correspondía mostrar', $2, now())
     RETURNING id`,
    [gerenciaReviewCaseId, ADMIN_ACTOR_ID]
  );
  gerenciaRedactedCommentId = Number(gerenciaCommentResult.rows[0].id);

  const gerenciaEventResult = await adminPool.query(
    `INSERT INTO governance.command_events
      (correlation_id, event_type, command_type, issue_id, actor_type, actor_user_id, actor_role, reason, before_state, after_state, service_actor_key)
     VALUES (gen_random_uuid(), 'ISSUE_ASSIGNED', 'review-case:assign', $1, 'HUMAN', $2, 'administracion', 'fixture', '{"status":"OPEN"}'::jsonb, '{"status":"IN_REVIEW"}'::jsonb, NULL)
     RETURNING id`,
    [gerenciaIssueId, ADMIN_ACTOR_ID]
  );
  gerenciaCommandEventId = Number(gerenciaEventResult.rows[0].id);
});

afterAll(async () => {
  if (!TEST_DB_URL) return;

  await adminPool.query(
    `DELETE FROM governance.command_events WHERE issue_id = ANY($1::bigint[]) OR review_case_id = ANY($2::bigint[])`,
    [[issueId, gerenciaIssueId], [reviewCaseId, gerenciaReviewCaseId]]
  );
  await adminPool.query(`DELETE FROM governance.review_case_comments WHERE review_case_id = ANY($1::bigint[])`, [[reviewCaseId, gerenciaReviewCaseId]]);
  await adminPool.query(`DELETE FROM governance.review_cases WHERE id = ANY($1::bigint[])`, [[reviewCaseId, gerenciaReviewCaseId]]);
  await adminPool.query(`DELETE FROM governance.issue_evidence WHERE issue_id = ANY($1::bigint[])`, [[issueId, gerenciaIssueId]]);
  await adminPool.query(`DELETE FROM governance.issues WHERE id = ANY($1::bigint[])`, [[issueId, gerenciaIssueId]]);
  await adminPool.query(`DELETE FROM governance.rule_evaluation_runs WHERE evaluation_run_id = $1`, [evaluationRunId]);
  await adminPool.query(`DELETE FROM governance.command_attempts WHERE command_type = 'audit:evidence-restricted' AND actor_user_id = ANY($1)`, [[ADMIN_ACTOR_ID, GERENCIA_ACTOR_ID]]);

  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("POST /api/audit/restricted/evidence - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/restricted/evidence/route.ts");

  await t.test("gerencia también puede revelar evidencia restringida - 200 (capacidades unificadas, sql/100)", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/restricted/evidence", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ evidenceId: gerenciaEvidenceId, reason: "gerencia ahora tiene audit:evidence-restricted" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.redactionLevel, "RESTRICTED_STRUCTURED");
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/evidence", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ evidenceId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("evidenceId inexistente -> 404 NOT_FOUND", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/evidence", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ evidenceId: 999999999, reason: "verificando comportamiento con id inexistente" })
      })
    );
    assert.equal(response.status, 404);
  });

  await t.test("administracion con razón revela el contenido restringido y queda auditado", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/evidence", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ evidenceId, reason: "investigando reclamo del cliente sobre este repuesto" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.redactionLevel, "RESTRICTED_STRUCTURED");
    assert.equal(body.ruleCode, "PART_NO_MATCH");
    assert.equal(body.observedValues.matchStatus, "NO_MATCH");

    const events = await adminPool.query(
      `SELECT reason FROM governance.command_events WHERE event_type = 'RESTRICTED_EVIDENCE_ACCESSED' AND evidence_id = $1`,
      [evidenceId]
    );
    assert.equal(events.rows.length, 1, "cada acceso a evidencia restringida queda registrado como un evento nuevo");
    assert.equal(events.rows[0].reason, "investigando reclamo del cliente sobre este repuesto");
  });

  await t.test("la evidencia restringida NUNCA aparece en la vista business_safe (nunca se filtra a nexus_app_read)", async () => {
    const businessSafeRows = await adminPool.query(`SELECT id FROM governance.issue_evidence_business_safe WHERE id = $1`, [evidenceId]);
    assert.equal(businessSafeRows.rows.length, 0);
  });
});

test("POST /api/audit/restricted/comment-original - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/restricted/comment-original/route.ts");

  await t.test("gerencia también puede revelar el comentario original - 200 (capacidades unificadas, sql/100)", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/restricted/comment-original", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ commentId: gerenciaRedactedCommentId, reason: "gerencia ahora tiene audit:evidence-restricted" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.body, "Contenido original sensible que fue redactado (gerencia)");
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/comment-original", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ commentId: redactedCommentId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("revela el body original del comentario redactado - el body NUNCA se borró de la tabla base", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/comment-original", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ commentId: redactedCommentId, reason: "auditoría legal solicitó el contenido original" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.body, "Contenido original sensible que fue redactado");

    const events = await adminPool.query(
      `SELECT reason FROM governance.command_events WHERE event_type = 'REDACTED_COMMENT_ACCESSED' AND review_case_id = $1`,
      [reviewCaseId]
    );
    assert.equal(events.rows.length, 1);
  });

  await t.test("el body original NUNCA aparece en review_case_comments_current cuando is_redacted=true", async () => {
    const curatedRows = await adminPool.query(`SELECT body FROM governance.review_case_comments_current WHERE id = $1`, [redactedCommentId]);
    assert.equal(curatedRows.rows[0].body, null);
  });
});

test("POST /api/audit/restricted/event-state - integración", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/restricted/event-state/route.ts");

  await t.test("gerencia también puede revelar before/after de un evento - 200 (capacidades unificadas, sql/100)", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/restricted/event-state", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ commandEventId: gerenciaCommandEventId, reason: "gerencia ahora tiene audit:evidence-restricted" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.beforeState.status, "OPEN");
    assert.equal(body.afterState.status, "IN_REVIEW");
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/event-state", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ commandEventId })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("revela before_state/after_state del evento - nunca visible en command_events_business_safe", async () => {
    const curated = await adminPool.query(`SELECT * FROM governance.command_events_business_safe WHERE id = $1`, [commandEventId]);
    assert.equal((curated.rows[0] as Record<string, unknown>).before_state, undefined, "before_state no es una columna de la vista curada");

    asAdministracion();
    const response = await POST(
      req("/api/audit/restricted/event-state", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ commandEventId, reason: "verificando la transición exacta de estado" })
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.beforeState.status, "OPEN");
    assert.equal(body.afterState.status, "IN_REVIEW");

    const events = await adminPool.query(
      `SELECT reason FROM governance.command_events WHERE event_type = 'RESTRICTED_EVENT_STATE_ACCESSED' AND issue_id = $1`,
      [issueId]
    );
    assert.equal(events.rows.length, 1);
  });
});
