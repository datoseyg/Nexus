// NEXUS V3 - sql/110_pipeline_claim_refresh_run_by_id.sql, específicamente
// su comportamiento de OWNERSHIP bajo un migrador NO superusuario (el caso
// real de Cloud) - distinto de test/pipeline/claim-refresh-run-by-id.integration.test.ts
// (que prueba el COMPORTAMIENTO EN TIEMPO DE EJECUCIÓN de la función ya
// instalada, no la migración en sí).
//
// Motivación real: un intento previo de aplicar este archivo contra Cloud
// falló, pero NO hizo rollback - la función quedó persistida con
// owner=governance_owner, prosecdef=true y ACL correcta. Reaplicar el
// archivo ORIGINAL (CREATE OR REPLACE directo + sweep final) contra ESE
// estado exacto vuelve a fallar: el migrador real es un rol NO
// superusuario, miembro de governance_owner con INHERIT FALSE/SET TRUE
// (mismo patrón que sql/089 establece) - sin un SET ROLE explícito, un
// CREATE OR REPLACE FUNCTION sobre una función que YA pertenece a
// governance_owner sale con "must be owner of function".
//
// Por qué esto necesita un rol de prueba dedicado, nunca `postgres`:
// bootstrap-disposable-postgres.mjs (el único caller de sql/*.sql en local,
// ver test/fieldbeat/sql-migration-idempotency.integration.test.ts) siempre
// conecta como superusuario - un superusuario bypassa CUALQUIER chequeo de
// ownership, así que la idempotencia local existente NUNCA hubiera
// detectado este bug. Este archivo crea un rol NO superusuario con
// EXACTAMENTE el mismo patrón de membership que el migrador real de Cloud,
// y aplica sql/110 tal cual (mismo texto que se aplicaría en Cloud) contra
// 4 estados de partida distintos.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "pipeline-claim-by-id-migration-test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const SQL_110_PATH = path.join(REPO_ROOT, "sql", "110_pipeline_claim_refresh_run_by_id.sql");

// Nombre exclusivo de este archivo - nunca colisiona con roles reales
// (nexus_*) ni con otros tests; se crea y se destruye acá.
const MIGRATOR_ROLE = "nexus_migration_test_role";
const MIGRATOR_PASSWORD = "local-test-migrator-password-never-real";
const FN_SIGNATURE = "pipeline.fn_claim_refresh_run_by_id(uuid,text,text,text)";

const { Pool } = pg;
let adminPool: pg.Pool; // superusuario - arregla el estado de partida de cada test
let migratorPool: pg.Pool; // rol NO superusuario - el sujeto real bajo prueba
let sql110Text: string;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:admin` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  sql110Text = readFileSync(SQL_110_PATH, "utf8");

  // Limpieza defensiva de una corrida anterior interrumpida (ej. el proceso
  // murió entre antes de llegar a afterAll) - DROP ROLE por sí solo puede
  // fallar si el rol quedó con privilegios/membresías colgantes; DROP OWNED
  // BY los limpia primero. Envuelto en un DO porque DROP OWNED BY exige que
  // el rol exista (no tiene variante IF EXISTS propia).
  await adminPool.query(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${MIGRATOR_ROLE}') THEN
        EXECUTE 'DROP OWNED BY ${MIGRATOR_ROLE}';
        EXECUTE 'DROP ROLE ${MIGRATOR_ROLE}';
      END IF;
    END
    $do$;
  `);

  // Mismo patrón que sql/089 establece para "quien aplique la migración" -
  // INHERIT FALSE (nunca hereda privilegios de governance_owner
  // automáticamente) + SET TRUE (puede SET ROLE governance_owner de forma
  // explícita). Sin NOSUPERUSER explícito no hace falta -un rol nuevo nunca
  // es superusuario por defecto.
  await adminPool.query(`CREATE ROLE ${MIGRATOR_ROLE} WITH LOGIN PASSWORD '${MIGRATOR_PASSWORD}'`);
  await adminPool.query(`GRANT USAGE ON SCHEMA pipeline TO ${MIGRATOR_ROLE}`);
  await adminPool.query(`GRANT governance_owner TO ${MIGRATOR_ROLE} WITH INHERIT FALSE, SET TRUE`);

  const migratorUrl = new URL(TEST_DB_URL);
  migratorUrl.username = MIGRATOR_ROLE;
  migratorUrl.password = MIGRATOR_PASSWORD;
  migratorPool = new Pool({ connectionString: migratorUrl.toString(), ssl: false, application_name: `${SUITE_ID}:migrator`, max: 2 });
});

afterAll(async () => {
  if (migratorPool) await migratorPool.end();
  if (adminPool) {
    // DROP OWNED BY primero (mismo motivo que en before()) - nunca dejar un
    // rol de prueba a medio limpiar para la siguiente corrida.
    await adminPool
      .query(`DROP OWNED BY ${MIGRATOR_ROLE}`)
      .then(() => adminPool.query(`DROP ROLE IF EXISTS ${MIGRATOR_ROLE}`))
      .catch(() => adminPool.query(`DROP ROLE IF EXISTS ${MIGRATOR_ROLE}`).catch(() => {}));
    await adminPool.end();
  }
});

async function dropFunction() {
  await adminPool.query(`DROP FUNCTION IF EXISTS ${FN_SIGNATURE}`);
}

async function currentOwner(): Promise<string | null> {
  const r = await adminPool.query<{ owner: string }>(
    `SELECT pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'pipeline' AND p.proname = 'fn_claim_refresh_run_by_id'`
  );
  return r.rows[0]?.owner ?? null;
}

async function ensureExistsOwnedByGovernanceOwner() {
  // Aplicar el archivo tal cual, como superusuario, siempre deja la función
  // en el estado final correcto (governance_owner) sin importar el punto de
  // partida -se usa acá solo para ARREGLAR precondiciones, nunca es lo que
  // se está probando (eso es siempre migratorPool más abajo).
  await adminPool.query(sql110Text);
}

async function applyMigrationAsMigrator(): Promise<void> {
  await migratorPool.query(sql110Text);
}

async function grantsForFunction(): Promise<{ grantee: string; privilege: string }[]> {
  const r = await adminPool.query<{ grantee: string; privilege_type: string }>(
    `SELECT g.grantee, g.privilege_type
     FROM information_schema.routine_privileges g
     JOIN information_schema.routines r ON r.specific_name = g.specific_name AND r.specific_schema = g.specific_schema
     WHERE g.routine_schema = 'pipeline' AND g.routine_name = 'fn_claim_refresh_run_by_id' AND g.privilege_type = 'EXECUTE'`
  );
  return r.rows.map(row => ({ grantee: row.grantee, privilege: row.privilege_type }));
}

test("sql/110 (migrador no-superusuario) - fresh: la función no existe -> aplica limpio, queda owner=governance_owner, grants correctos", { skip: !TEST_DB_URL }, async () => {
  await dropFunction();
  assert.equal(await currentOwner(), null, "precondición: la función no debe existir");

  await applyMigrationAsMigrator();

  assert.equal(await currentOwner(), "governance_owner");
  const grants = await grantsForFunction();
  assert.ok(grants.some(g => g.grantee === "nexus_pipeline_worker"));
  assert.ok(!grants.some(g => g.grantee === "PUBLIC"));
});

test("sql/110 (migrador no-superusuario) - PREEXISTENTE + owner=governance_owner (estado real observado en Cloud tras el intento fallido) -> aplica limpio, PASS", { skip: !TEST_DB_URL }, async () => {
  await ensureExistsOwnedByGovernanceOwner();
  assert.equal(await currentOwner(), "governance_owner", "precondición: debe existir y pertenecer ya a governance_owner");

  // Esto es EXACTAMENTE lo que falló antes de la corrección: reaplicar el
  // archivo, como el migrador real (no superusuario), contra una función
  // que YA pertenece a governance_owner.
  await applyMigrationAsMigrator();

  assert.equal(await currentOwner(), "governance_owner", "debe seguir siendo governance_owner, sin ALTER redundante ni error");
  const grants = await grantsForFunction();
  assert.ok(grants.some(g => g.grantee === "nexus_pipeline_worker"));
  assert.ok(!grants.some(g => g.grantee === "PUBLIC"));
});

test("sql/110 (migrador no-superusuario) - partial-owned-by-migrator: la función existe pero la posee el propio rol que corre la migración -> aplica limpio, transfiere a governance_owner", { skip: !TEST_DB_URL }, async () => {
  await ensureExistsOwnedByGovernanceOwner();
  await adminPool.query(`ALTER FUNCTION ${FN_SIGNATURE} OWNER TO ${MIGRATOR_ROLE}`);
  assert.equal(await currentOwner(), MIGRATOR_ROLE, "precondición: el propio migrador debe ser el owner actual");

  await applyMigrationAsMigrator();

  assert.equal(await currentOwner(), "governance_owner", "el migrador debe poder transferirse la función a sí mismo -> governance_owner");
  const grants = await grantsForFunction();
  assert.ok(grants.some(g => g.grantee === "nexus_pipeline_worker"));
});

test("sql/110 (migrador no-superusuario) - unexpected-third-owner: la función existe con un owner que no es ni governance_owner ni el migrador -> falla fuerte, sin DROP ni reparación silenciosa", { skip: !TEST_DB_URL }, async () => {
  await ensureExistsOwnedByGovernanceOwner();
  // nexus_pipeline_worker existe siempre (sql/101) y nunca es ni
  // governance_owner ni el rol migrador de este test - stand-in perfecto
  // para "algún otro owner inesperado".
  await adminPool.query(`ALTER FUNCTION ${FN_SIGNATURE} OWNER TO nexus_pipeline_worker`);
  assert.equal(await currentOwner(), "nexus_pipeline_worker", "precondición: owner inesperado, ajeno a este migrador");

  await assert.rejects(
    () => applyMigrationAsMigrator(),
    /owner inesperado/,
    "debe fallar fuerte y explícito, nombrando el owner real - nunca proceder en silencio"
  );

  // Nunca reparación automática: el owner sigue siendo el inesperado -
  // ningún DROP, ninguna reasignación forzada por la migración fallida.
  assert.equal(await currentOwner(), "nexus_pipeline_worker", "el intento fallido nunca debe alterar el owner real");

  // Limpieza -deja la función en el estado esperado para no afectar otros
  // tests que puedan correr en la misma base desechable. Nunca un ALTER
  // OWNER suelto acá: Postgres elimina automáticamente cualquier entrada de
  // ACL redundante del rol que se está CONVIRTIENDO en owner (nexus_pipeline_worker
  // ya tenía EXECUTE explícito, otorgado por governance_owner - al pasar a
  // ser owner en la línea de arriba, esa entrada se volvió "redundante" y
  // Postgres la descartó; un ALTER OWNER de vuelta a governance_owner NO la
  // restaura solo). Reaplicar el archivo completo como superusuario repone
  // owner Y grants correctos de una sola vez, sin depender de ese detalle.
  await adminPool.query(`ALTER FUNCTION ${FN_SIGNATURE} OWNER TO governance_owner`);
  await ensureExistsOwnedByGovernanceOwner();
  assert.ok((await grantsForFunction()).some(g => g.grantee === "nexus_pipeline_worker"), "limpieza: el grant de nexus_pipeline_worker debe quedar restaurado");
});
