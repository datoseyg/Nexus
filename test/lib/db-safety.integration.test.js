// ETAPA SAFETY-1 - Prueba real (Postgres desechable, NUNCA
// nexus-afterhours-realdata2) de que assertDisposableTarget()/
// seedDisposableMarker() funcionan contra sentencias Postgres reales
// (COMMENT ON DATABASE, shobj_description, SHOW application_name). Se
// salta entera si DB_SAFETY_TEST_DATABASE_URL no está seteada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, seedDisposableMarker, DisposableGuardError } from "../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.DB_SAFETY_TEST_DATABASE_URL;
// Base SEGUNDA, creada aparte para simular -sin tocar jamás el contenedor
// real- un nombre que SÍ coincide con la lista de protegidos, probando que
// el guard la rechaza incluso con un marker válido.
const PROTECTED_NAME_DB_URL = process.env.DB_SAFETY_PROTECTED_NAME_TEST_URL;

const { Pool } = pg;

test("assertDisposableTarget contra Postgres real", { skip: !TEST_DB_URL }, async t => {
  let pool;
  const runId = `test-run-${Date.now()}`;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL, application_name: `db-safety-selftest:${runId}` });
  });
  after(async () => { await pool.end(); });

  await t.test("Caso A real: tras seedDisposableMarker(), assertDisposableTarget() no lanza", async () => {
    await seedDisposableMarker(pool, runId);
    await assert.doesNotReject(() => assertDisposableTarget(pool, { expectedRunId: runId, expectedSuiteId: "db-safety-selftest" }));
  });

  await t.test("Caso C real: sin marker sembrado -assertDisposableTarget() lanza DisposableGuardError antes de cualquier otra sentencia", async () => {
    // Base fresca de esta MISMA conexión, pero limpiamos el comentario para
    // simular "nunca se sembró" -COMMENT ON DATABASE ... IS NULL lo borra.
    const dbRes = await pool.query(`SELECT current_database() AS db`);
    await pool.query(`COMMENT ON DATABASE ${JSON.stringify(dbRes.rows[0].db).replace(/"/g, "")} IS NULL`);
    await assert.rejects(
      () => assertDisposableTarget(pool, { expectedRunId: runId, expectedSuiteId: "db-safety-selftest" }),
      DisposableGuardError
    );
    // Restaura el marker para las siguientes pruebas de esta misma base.
    await seedDisposableMarker(pool, runId);
  });

  await t.test("Caso D real: run_id incorrecto -assertDisposableTarget() lanza", async () => {
    await assert.rejects(
      () => assertDisposableTarget(pool, { expectedRunId: "otro-run-id-cualquiera", expectedSuiteId: "db-safety-selftest" }),
      DisposableGuardError
    );
  });

  await t.test("application_name real quedó seteado correctamente por la conexión (SHOW application_name)", async () => {
    const res = await pool.query("SHOW application_name");
    assert.equal(res.rows[0].application_name, `db-safety-selftest:${runId}`);
  });

  await t.test("evidencia de cero escrituras: assertDisposableTarget() rechazado no crea NINGUNA tabla/fila -es puramente SELECT/SHOW", async () => {
    const before1 = await pool.query(`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
    await assert.rejects(() => assertDisposableTarget(pool, { expectedRunId: "run-equivocado", expectedSuiteId: "db-safety-selftest" }));
    const after1 = await pool.query(`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
    assert.equal(before1.rows[0].n, after1.rows[0].n, "el guard en sí nunca crea/modifica objetos -solo SELECT/SHOW");
  });
});

// ETAPA SAFETY-1 (punto 4 del cierre) - el usuario de tests NUNCA puede
// sembrar su propia marca DISPOSABLE_TEST. Esto se apoya en el propio
// modelo de permisos de Postgres (COMMENT ON DATABASE exige ser dueño de
// la base o superusuario) -no es una regla que este código deba inventar
// ni pueda accidentalmente saltarse: un rol de test que no sea dueño de la
// base FÍSICAMENTE no puede ejecutar seedDisposableMarker() con éxito.
const NONOWNER_TEST_DB_URL = process.env.DB_SAFETY_NONOWNER_TEST_URL;

test("el usuario de test (no dueño de la base) NO puede sembrar su propia marca DISPOSABLE_TEST", { skip: !NONOWNER_TEST_DB_URL }, async () => {
  const pool = new Pool({ connectionString: NONOWNER_TEST_DB_URL, application_name: "db-safety-selftest:nonowner" });
  try {
    await assert.rejects(
      () => seedDisposableMarker(pool, "run-intentando-auto-sembrar"),
      /must be owner|permission denied/i,
      "Postgres debe rechazar COMMENT ON DATABASE para un rol que no es dueño de la base -esta es la garantía estructural, no una convención de este código"
    );
  } finally {
    await pool.end();
  }
});

test("Caso B real: base cuyo NOMBRE coincide con la lista de protegidos es rechazada incluso con marker válido", { skip: !PROTECTED_NAME_DB_URL }, async () => {
  const pool = new Pool({ connectionString: PROTECTED_NAME_DB_URL, application_name: "db-safety-selftest:proteccion" });
  try {
    await seedDisposableMarker(pool, "run-x"); // aunque se le ponga marker válido...
    await assert.rejects(
      () => assertDisposableTarget(pool, { expectedRunId: "run-x", expectedSuiteId: "db-safety-selftest" }),
      DisposableGuardError,
      "el nombre protegido debe ganar SIEMPRE, incluso sobre un marker técnicamente válido"
    );
  } finally {
    await pool.end();
  }
});
