// Unificación de capacidades gerencia/administracion (sql/100_role_
// capabilities_unification.sql) - pruebas de integración contra un Postgres
// real y DESECHABLE, mismo mecanismo de seguridad que
// test/audit/no-part-used-classification.integration.test.ts.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "role-capabilities-unification-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let pool: pg.Pool;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  pool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(pool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
});

afterAll(async () => {
  if (pool) await pool.end();
});

async function capabilitiesFor(role: string): Promise<string[]> {
  const r = await pool.query<{ capability: string }>(
    "SELECT capability FROM governance.role_capabilities WHERE role = $1 ORDER BY capability",
    [role]
  );
  return r.rows.map(row => row.capability);
}

test("gerencia y administracion tienen exactamente el mismo set de capacidades tras sql/100", { skip: !TEST_DB_URL }, async () => {
  const gerencia = await capabilitiesFor("gerencia");
  const administracion = await capabilitiesFor("administracion");

  assert.ok(gerencia.length > 0, "gerencia no debería tener 0 capacidades - sql/089/sql/100 no se aplicaron");
  assert.deepEqual(gerencia, administracion);
});

test("data:refresh:observe/incremental/full están concedidas a ambos roles", { skip: !TEST_DB_URL }, async () => {
  const gerencia = await capabilitiesFor("gerencia");
  for (const capability of ["data:refresh:observe", "data:refresh:incremental", "data:refresh:full"]) {
    assert.ok(gerencia.includes(capability), `gerencia debería tener "${capability}"`);
  }
});

test("aplicar sql/100 dos veces seguidas es idempotente (ON CONFLICT DO NOTHING)", { skip: !TEST_DB_URL }, async () => {
  const before1 = await capabilitiesFor("gerencia");
  // Reaplicar el mismo INSERT ... SELECT ... ON CONFLICT DO NOTHING que
  // sql/100 ejecuta - nunca debe duplicar filas ni lanzar error.
  await pool.query(`
    INSERT INTO governance.role_capabilities (role, capability)
    SELECT 'gerencia', capability
    FROM governance.role_capabilities
    WHERE role = 'administracion'
    ON CONFLICT (role, capability) DO NOTHING;
  `);
  const after1 = await capabilitiesFor("gerencia");
  assert.deepEqual(before1, after1);
});
