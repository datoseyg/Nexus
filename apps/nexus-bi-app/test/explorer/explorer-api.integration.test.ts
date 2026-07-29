// Pruebas de integración del Explorador semántico (Gate B, B20-B23) contra un
// Postgres 16 real y DESECHABLE - mismo mecanismo de seguridad que
// test/fieldbeat/*.integration.test.ts. No inserta fixtures propios para
// clients/equipment/products/contracts/technicians (esas tablas se pueblan
// vía scripts de import de datos reales, fuera del bootstrap de esquema) -
// valida en cambio que cada consulta de las 9 entidades es sintáctica y
// referencialmente válida contra el esquema real (columnas existentes,
// joins correctos) incluso con 0 filas, más el contrato de auth/paginación/
// errores. reports/tickets/parts se ejercitan además con fixtures propios
// para confirmar conteos reales.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "explorer-api-gate-b-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_NAME = "EXPLORER_TEST_CLIENT";
const TASK_ID_MIN = 970001;
const TASK_ID_MAX = 970002;
const TICKET_ID = 970099;

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "explorer-api-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

function noSession() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: null, error: null };
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

  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.zendesk_tickets WHERE zendesk_ticket_id = $1`, [TICKET_ID]);

  await adminPool.query(
    `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, description) VALUES ($1, 'fixture explorer'), ($2, 'fixture explorer 2')`,
    [TASK_ID_MIN, TASK_ID_MAX]
  );
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
      (fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, equipment_internal_ids, linked_zendesk_ticket_id, used_parts_count)
     VALUES
      ($1, now(), $3, 'PM', 'EXP-EQUIP-1', $4::text, 0),
      ($2, now(), $3, 'CM', 'EXP-EQUIP-1', NULL, 0)`,
    [TASK_ID_MIN, TASK_ID_MAX, CLIENT_NAME, TICKET_ID]
  );
  await adminPool.query(
    `INSERT INTO processed.zendesk_tickets (zendesk_ticket_id, subject, status, created_at) VALUES ($1, 'Fixture ticket', 'open', now())`,
    [TICKET_ID]
  );
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.zendesk_tickets WHERE zendesk_ticket_id = $1`, [TICKET_ID]);
  await adminPool.end();
});

const ALL_ENTITIES = ["clients", "equipment", "technicians", "reports", "tickets", "parts", "products", "contracts", "issues"];

test("GET /api/explorer/[entity] - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/explorer/[entity]/route.ts");

  await t.test("401 sin sesión", async () => {
    noSession();
    const response = await GET(req("/api/explorer/reports"), { params: Promise.resolve({ entity: "reports" }) });
    assert.equal(response.status, 401);
  });

  await t.test("404 para entidad desconocida", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/bogus-entity"), { params: Promise.resolve({ entity: "bogus-entity" }) });
    assert.equal(response.status, 404);
  });

  for (const entity of ALL_ENTITIES) {
    await t.test(`200 con forma válida para entidad "${entity}"`, async () => {
      asGerencia();
      const response = await GET(req(`/api/explorer/${entity}?page=1&pageSize=25`), { params: Promise.resolve({ entity }) });
      assert.equal(response.status, 200, `esperado 200 para ${entity}`);
      const body = await response.json();
      assert.equal(body.entity, entity);
      assert.equal(body.page, 1);
      assert.equal(body.pageSize, 25);
      assert.ok(Array.isArray(body.rows));
      assert.ok(typeof body.totalRows === "number");
      assert.ok(typeof body.totalPages === "number");
    });
  }

  await t.test("reports: fixtures reales aparecen en el listado", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/reports?page=1&pageSize=100"), { params: Promise.resolve({ entity: "reports" }) });
    const body = await response.json();
    const ids = body.rows.map((r: { fieldbeat_task_id: unknown }) => Number(r.fieldbeat_task_id));
    assert.ok(ids.includes(TASK_ID_MIN) && ids.includes(TASK_ID_MAX));
  });

  await t.test("tickets: fixture real aparece en el listado", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/tickets?page=1&pageSize=100"), { params: Promise.resolve({ entity: "tickets" }) });
    const body = await response.json();
    const ids = body.rows.map((r: { zendesk_ticket_id: unknown }) => Number(r.zendesk_ticket_id));
    assert.ok(ids.includes(TICKET_ID));
  });
});

test("GET /api/explorer/detail - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/explorer/detail/route.ts");

  await t.test("400 sin entity/key", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/detail"));
    assert.equal(response.status, 400);
  });

  await t.test("400 ENTITY_RETIRED para entity=reports (usa el drawer canónico)", async () => {
    asGerencia();
    const response = await GET(req(`/api/explorer/detail?entity=reports&key=${TASK_ID_MIN}`));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "ENTITY_RETIRED");
  });

  await t.test("404 para entidad no soportada", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/detail?entity=bogus&key=x"));
    assert.equal(response.status, 404);
  });

  await t.test("200 con identity + summary + related para tickets (fixture real)", async () => {
    asGerencia();
    const response = await GET(req(`/api/explorer/detail?entity=tickets&key=${TICKET_ID}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entity, "tickets");
    assert.equal(body.identity.resolutionStatus, "DIRECT");
    assert.equal(Number(body.summary.ticketId), TICKET_ID);
    assert.ok(Array.isArray(body.related.linkedReports));
  });

  await t.test("404 para tickets con key inexistente", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/detail?entity=tickets&key=999999999"));
    assert.equal(response.status, 404);
  });
});
