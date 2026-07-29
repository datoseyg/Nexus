// Pruebas de integración de Gate B - Familia 4: casos de revisión completos
// (crear, agregar issue, terminar membership, asignar, comentar, comentario
// que reemplaza a otro, redactar, cerrar, reabrir). Invariantes cubiertas:
// una sola membresía activa por issue; cierre en cascada de TODAS las
// membresías activas; reentrada histórica (reabrir el caso NO restaura
// membresías terminadas); comentario inmutable (nunca UPDATE de `body`);
// redacción sin borrar el body (solo oculto por la vista, el dato persiste);
// versiones obsoletas (409); permisos basados en capacidad (audit:review/
// audit:assign/audit:comment/correction:redact-comment); actor derivado de
// la sesión (nunca del body).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "audit-review-cases-gate-b-test";

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

const ENTITY_KEYS = [
  "reviewcase-test-975301",
  "reviewcase-test-975302",
  "reviewcase-test-975303",
  "reviewcase-test-975304",
  "reviewcase-test-975305",
  "reviewcase-test-975306"
];
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

let issueIds: number[] = [];

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM governance.issues WHERE entity_key = ANY($1::text[])`, [ENTITY_KEYS]);

  issueIds = [];
  for (let i = 0; i < ENTITY_KEYS.length; i++) {
    issueIds.push(await insertOpenIssue(ENTITY_KEYS[i], `reviewcase-test-fingerprint-${i}`));
  }
});

afterAll(async () => {
  if (!TEST_DB_URL) return;

  const caseIdsResult = await adminPool.query(
    `SELECT DISTINCT review_case_id FROM governance.review_case_issues WHERE issue_id = ANY($1::bigint[])`,
    [issueIds]
  );
  const caseIds = caseIdsResult.rows.map(row => Number(row.review_case_id));

  await adminPool.query(`DELETE FROM governance.command_events WHERE issue_id = ANY($1::bigint[]) OR review_case_id = ANY($2::bigint[])`, [issueIds, caseIds]);
  await adminPool.query(`DELETE FROM governance.review_case_comments WHERE review_case_id = ANY($1::bigint[])`, [caseIds]);
  await adminPool.query(`DELETE FROM governance.review_case_issues WHERE issue_id = ANY($1::bigint[])`, [issueIds]);
  await adminPool.query(`DELETE FROM governance.review_cases WHERE id = ANY($1::bigint[])`, [caseIds]);
  await adminPool.query(`DELETE FROM governance.issues WHERE id = ANY($1::bigint[])`, [issueIds]);
  await adminPool.query(`DELETE FROM governance.idempotency_keys WHERE idempotency_key LIKE 'rc-test-%'`);
  await adminPool.query(`DELETE FROM governance.command_attempts WHERE command_type LIKE 'review-case:%' AND actor_user_id = $1`, [ADMIN_ACTOR_ID]);

  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("POST /api/audit/review-cases - crear caso", { skip: !TEST_DB_URL }, async t => {
  const { POST } = await import("../../app/api/audit/review-cases/route.ts");

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await POST(
      req("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-create-gerencia" },
        body: JSON.stringify({ issueIds: [issueIds[0]], reason: "x" })
      })
    );
    assert.equal(response.status, 403);
  });

  await t.test("rechaza sin issueIds (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-create-no-issues" },
        body: JSON.stringify({ issueIds: [], reason: "x" })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("rechaza sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-create-no-reason" },
        body: JSON.stringify({ issueIds: [issueIds[0]] })
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("crea un caso con 2 issues, actor derivado de la sesión (nunca del body)", async () => {
    asAdministracion();
    const response = await POST(
      req("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-create-happy" },
        body: JSON.stringify({ issueIds: [issueIds[0], issueIds[1]], reason: "agrupando dos ocurrencias del mismo repuesto" })
      })
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.result, "APPLIED");
    assert.ok(body.reviewCaseId);

    const memberships = await adminPool.query(
      `SELECT issue_id, membership_ended_at FROM governance.review_case_issues WHERE review_case_id = $1 ORDER BY issue_id`,
      [body.reviewCaseId]
    );
    assert.equal(memberships.rows.length, 2);
    assert.ok(memberships.rows.every(row => row.membership_ended_at === null));

    const event = await adminPool.query(
      `SELECT actor_user_id, actor_type FROM governance.command_events WHERE review_case_id = $1 AND event_type = 'REVIEW_CASE_CREATED'`,
      [body.reviewCaseId]
    );
    assert.equal(event.rows[0].actor_user_id, ADMIN_ACTOR_ID, "el actor registrado es siempre el de la sesión, nunca uno enviado en el body");
    assert.equal(event.rows[0].actor_type, "HUMAN");

    (globalThis as unknown as { __rcTestCaseId?: number }).__rcTestCaseId = body.reviewCaseId;
  });
});

test("Casos - agregar issue / terminar membership / única membresía activa", { skip: !TEST_DB_URL }, async t => {
  const { POST: addIssuePost } = await import("../../app/api/audit/review-cases/[id]/add-issue/route.ts");
  const { POST: endMembershipPost } = await import("../../app/api/audit/review-cases/[id]/end-membership/route.ts");
  const { POST: createPost } = await import("../../app/api/audit/review-cases/route.ts");

  const caseId = (globalThis as unknown as { __rcTestCaseId: number }).__rcTestCaseId;

  await t.test("agrega un tercer issue al caso existente", async () => {
    asAdministracion();
    const caseRow = await adminPool.query(`SELECT version FROM governance.review_cases WHERE id = $1`, [caseId]);
    const response = await addIssuePost(
      req(`/api/audit/review-cases/${caseId}/add-issue`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-add-issue" },
        body: JSON.stringify({ issueId: issueIds[2], reason: "mismo repuesto, mismo cliente", expectedVersion: caseRow.rows[0].version })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 200);

    const membership = await adminPool.query(
      `SELECT membership_ended_at FROM governance.review_case_issues WHERE review_case_id = $1 AND issue_id = $2`,
      [caseId, issueIds[2]]
    );
    assert.equal(membership.rows.length, 1);
    assert.equal(membership.rows[0].membership_ended_at, null);
  });

  await t.test("rechaza agregar un issue que ya tiene membresía activa en OTRO caso (única membresía activa, B53)", async () => {
    asAdministracion();
    // issueIds[0] ya está activo en `caseId` - crear un segundo caso y tratar de agregarlo ahí.
    const secondCaseResponse = await createPost(
      req("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-second-case" },
        body: JSON.stringify({ issueIds: [issueIds[3]], reason: "caso separado para probar la invariante de membresía única" })
      })
    );
    assert.equal(secondCaseResponse.status, 201);
    const secondCase = await secondCaseResponse.json();

    const response = await addIssuePost(
      req(`/api/audit/review-cases/${secondCase.reviewCaseId}/add-issue`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-add-issue-conflict" },
        body: JSON.stringify({ issueId: issueIds[0], reason: "intento inválido" })
      }),
      { params: Promise.resolve({ id: String(secondCase.reviewCaseId) }) }
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("termina la membresía de un issue sin cerrar el caso completo", async () => {
    asAdministracion();
    const caseRow = await adminPool.query(`SELECT version FROM governance.review_cases WHERE id = $1`, [caseId]);
    const response = await endMembershipPost(
      req(`/api/audit/review-cases/${caseId}/end-membership`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-end-membership" },
        body: JSON.stringify({ issueId: issueIds[2], reason: "no correspondía a este caso", expectedVersion: caseRow.rows[0].version })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 200);

    const membership = await adminPool.query(
      `SELECT membership_ended_at, membership_end_reason FROM governance.review_case_issues WHERE review_case_id = $1 AND issue_id = $2`,
      [caseId, issueIds[2]]
    );
    assert.ok(membership.rows[0].membership_ended_at);
    assert.equal(membership.rows[0].membership_end_reason, "REMOVED_BY_ACTOR");

    const caseStatus = await adminPool.query(`SELECT status FROM governance.review_cases WHERE id = $1`, [caseId]);
    assert.notEqual(caseStatus.rows[0].status, "RESOLVED");
    assert.notEqual(caseStatus.rows[0].status, "DISMISSED");
  });

  await t.test("rechaza terminar membership sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await endMembershipPost(
      req(`/api/audit/review-cases/${caseId}/end-membership`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-end-membership-no-reason" },
        body: JSON.stringify({ issueId: issueIds[1] })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });
});

test("Casos - asignar (capacidad audit:assign)", { skip: !TEST_DB_URL }, async t => {
  const { POST: assignPost } = await import("../../app/api/audit/review-cases/[id]/assign/route.ts");
  const caseId = (globalThis as unknown as { __rcTestCaseId: number }).__rcTestCaseId;

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await assignPost(
      req(`/api/audit/review-cases/${caseId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-assign-gerencia" },
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 403);
  });

  await t.test("administracion se autoasigna (assigneeUserId omitido -> sesión actual)", async () => {
    asAdministracion();
    const caseRow = await adminPool.query(`SELECT version FROM governance.review_cases WHERE id = $1`, [caseId]);
    const response = await assignPost(
      req(`/api/audit/review-cases/${caseId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-assign-happy" },
        body: JSON.stringify({ reason: "tomo este caso", expectedVersion: caseRow.rows[0].version })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 200);

    const row = await adminPool.query(`SELECT assigned_to, status FROM governance.review_cases WHERE id = $1`, [caseId]);
    assert.equal(row.rows[0].assigned_to, ADMIN_ACTOR_ID);
    assert.equal(row.rows[0].status, "IN_REVIEW");
  });

  await t.test("version conflict devuelve 409 y registra el intento", async () => {
    asAdministracion();
    const response = await assignPost(
      req(`/api/audit/review-cases/${caseId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-assign-conflict" },
        body: JSON.stringify({ reason: "reintento con version vieja", expectedVersion: 1 })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "VERSION_CONFLICT");

    const attempts = await adminPool.query(
      `SELECT error_code FROM governance.command_attempts WHERE command_type = 'review-case:assign' AND error_code = 'VERSION_CONFLICT' ORDER BY id DESC LIMIT 1`
    );
    assert.equal(attempts.rows.length, 1);
  });
});

test("Casos - comentarios (inmutables, redacción sin borrar body)", { skip: !TEST_DB_URL }, async t => {
  const { POST: commentPost } = await import("../../app/api/audit/review-cases/[id]/comment/route.ts");
  const { POST: redactPost } = await import("../../app/api/audit/review-cases/comments/[commentId]/redact/route.ts");
  const caseId = (globalThis as unknown as { __rcTestCaseId: number }).__rcTestCaseId;

  let firstCommentId: number;

  await t.test("rechaza a gerencia con 403 FORBIDDEN", async () => {
    asGerencia();
    const response = await commentPost(
      req(`/api/audit/review-cases/${caseId}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-comment-gerencia" },
        body: JSON.stringify({ body: "x" })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 403);
  });

  await t.test("agrega un comentario", async () => {
    asAdministracion();
    const response = await commentPost(
      req(`/api/audit/review-cases/${caseId}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-comment-1" },
        body: JSON.stringify({ body: "Confirmado con el técnico, es el mismo repuesto." })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    firstCommentId = Number(body.commentId);
    assert.ok(firstCommentId);
  });

  await t.test("un segundo comentario puede reemplazar al primero (supersedesCommentId) - nunca UPDATE del body original", async () => {
    asAdministracion();
    const response = await commentPost(
      req(`/api/audit/review-cases/${caseId}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-comment-2" },
        body: JSON.stringify({ body: "Corrección: no era el mismo repuesto, era uno similar.", supersedesCommentId: firstCommentId })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 201);

    const original = await adminPool.query(`SELECT body FROM governance.review_case_comments WHERE id = $1`, [firstCommentId]);
    assert.equal(original.rows[0].body, "Confirmado con el técnico, es el mismo repuesto.", "el comentario original nunca se edita in-place");
  });

  await t.test("redacta el primer comentario - body persiste en la tabla base, oculto solo en la vista curada", async () => {
    asAdministracion();
    const response = await redactPost(
      req(`/api/audit/review-cases/comments/${firstCommentId}/redact`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-redact" },
        body: JSON.stringify({ redactionReason: "contenido incorrecto, mantenido para auditoría" })
      }),
      { params: Promise.resolve({ commentId: String(firstCommentId) }) }
    );
    assert.equal(response.status, 200);

    const rawRow = await adminPool.query(`SELECT body, is_redacted FROM governance.review_case_comments WHERE id = $1`, [firstCommentId]);
    assert.equal(rawRow.rows[0].is_redacted, true);
    assert.equal(rawRow.rows[0].body, "Confirmado con el técnico, es el mismo repuesto.", "redactar NUNCA borra el body de la tabla base");

    const curatedRow = await adminPool.query(`SELECT body, is_redacted FROM governance.review_case_comments_current WHERE id = $1`, [firstCommentId]);
    assert.equal(curatedRow.rows[0].body, null, "la vista curada oculta el body cuando is_redacted=true");
  });

  await t.test("rechaza redactar sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const commentResponse = await commentPost(
      req(`/api/audit/review-cases/${caseId}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-comment-3" },
        body: JSON.stringify({ body: "comentario para probar redacción sin razón" })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    const commentBody = await commentResponse.json();

    const response = await redactPost(
      req(`/api/audit/review-cases/comments/${commentBody.commentId}/redact`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-redact-no-reason" },
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ commentId: String(commentBody.commentId) }) }
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });
});

test("Casos - cerrar (cascada de membresías) / reabrir (sin reentrada histórica)", { skip: !TEST_DB_URL }, async t => {
  const { POST: createPost } = await import("../../app/api/audit/review-cases/route.ts");
  const { POST: closePost } = await import("../../app/api/audit/review-cases/[id]/close/route.ts");
  const { POST: reopenPost } = await import("../../app/api/audit/review-cases/[id]/reopen/route.ts");

  let cascadeCaseId: number;

  await t.test("rechaza cerrar sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const caseId = (globalThis as unknown as { __rcTestCaseId: number }).__rcTestCaseId;
    const response = await closePost(
      req(`/api/audit/review-cases/${caseId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-close-no-reason" },
        body: JSON.stringify({ finalStatus: "RESOLVED" })
      }),
      { params: Promise.resolve({ id: String(caseId) }) }
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("cierra un caso con 2 issues activos -> cierra en cascada AMBAS membresías en la misma transacción (B53)", async () => {
    asAdministracion();
    // issueIds[4]/issueIds[5] son dedicados a este bloque - issueIds[0..3] ya
    // tienen historia de membresía de los bloques anteriores (algunos siguen
    // activos), y reutilizarlos violaría la invariante de membresía única
    // (review_case_issues_one_active_membership) contra el propio caso de
    // prueba, no contra el código bajo prueba.
    const createResponse = await createPost(
      req("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-cascade-create" },
        body: JSON.stringify({ issueIds: [issueIds[4], issueIds[5]], reason: "caso para probar cierre en cascada" })
      })
    );
    const created = await createResponse.json();
    cascadeCaseId = created.reviewCaseId;

    const response = await closePost(
      req(`/api/audit/review-cases/${cascadeCaseId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-close-happy" },
        body: JSON.stringify({ finalStatus: "RESOLVED", reason: "ambas incidencias corregidas" })
      }),
      { params: Promise.resolve({ id: String(cascadeCaseId) }) }
    );
    assert.equal(response.status, 200);

    const memberships = await adminPool.query(
      `SELECT issue_id, membership_ended_at, membership_end_reason FROM governance.review_case_issues WHERE review_case_id = $1`,
      [cascadeCaseId]
    );
    assert.equal(memberships.rows.length, 2);
    assert.ok(memberships.rows.every(row => row.membership_ended_at !== null && row.membership_end_reason === "CASE_CLOSED"), "cerrar el caso termina TODAS sus membresías activas, nunca deja una activa asociada a un caso cerrado");
  });

  await t.test("no se puede volver a cerrar un caso ya cerrado (400 VALIDATION_ERROR)", async () => {
    asAdministracion();
    const response = await closePost(
      req(`/api/audit/review-cases/${cascadeCaseId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-close-twice" },
        body: JSON.stringify({ finalStatus: "RESOLVED", reason: "intento inválido" })
      }),
      { params: Promise.resolve({ id: String(cascadeCaseId) }) }
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  await t.test("reabre el caso -> IN_REVIEW, sin restaurar las membresías ya terminadas (nunca reentrada histórica automática)", async () => {
    asAdministracion();
    const caseRow = await adminPool.query(`SELECT version FROM governance.review_cases WHERE id = $1`, [cascadeCaseId]);
    const response = await reopenPost(
      req(`/api/audit/review-cases/${cascadeCaseId}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-reopen-happy" },
        body: JSON.stringify({ reason: "se detectó una tercera ocurrencia relacionada", expectedVersion: caseRow.rows[0].version })
      }),
      { params: Promise.resolve({ id: String(cascadeCaseId) }) }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "IN_REVIEW");

    const memberships = await adminPool.query(
      `SELECT membership_ended_at FROM governance.review_case_issues WHERE review_case_id = $1`,
      [cascadeCaseId]
    );
    assert.ok(memberships.rows.every(row => row.membership_ended_at !== null), "reabrir el CASO nunca restaura membresías que el cierre ya terminó - se agregan issues nuevos explícitamente");
  });

  await t.test("rechaza reabrir sin razón (400 REASON_REQUIRED)", async () => {
    asAdministracion();
    const response = await reopenPost(
      req(`/api/audit/review-cases/${cascadeCaseId}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "idempotency-key": "rc-test-reopen-no-reason" },
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ id: String(cascadeCaseId) }) }
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");
  });

  await t.test("rechaza Origin ausente en una mutación (403)", async () => {
    asAdministracion();
    const response = await reopenPost(
      req(`/api/audit/review-cases/${cascadeCaseId}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "rc-test-no-origin" },
        body: JSON.stringify({ reason: "sin origin" })
      }),
      { params: Promise.resolve({ id: String(cascadeCaseId) }) }
    );
    assert.equal(response.status, 403);
  });
});
