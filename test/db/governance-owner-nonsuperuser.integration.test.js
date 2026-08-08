// Reproduce y prueba el fix del bug real de bootstrap contra Supabase:
// "ERROR: 42501: must be able to SET ROLE governance_owner" al ejecutar
// ALTER FUNCTION ... OWNER TO governance_owner (sql/090/096/101) bajo un
// rol administrativo NO superusuario (Supabase entrega `postgres` con
// privilegios administrativos, pero sin superuser real). La integración
// existente (todas las demás suites de este directorio) corre como
// superusuario local -eso NUNCA reproduce esta restricción, porque un
// superusuario puede SET ROLE a cualquier rol sin necesitar membresía
// explícita. Esta suite crea, desde el propio superusuario local, un rol
// migrador CREATEROLE (nunca superuser) y reproduce el escenario real
// contra un doble de governance_owner -nunca toca el governance_owner real
// de la base compartida ni depende de él.
//
// Reutiliza CONTRACTS_TEST_DATABASE_URL (mismo Postgres desechable que el
// resto de test/db/) - solo para tener un superusuario local desde el cual
// crear los roles de prueba; nunca se aplica sql/*.sql acá.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight, describeConnectionTarget } from "../../src/lib/db-safety.js";

const { Pool } = pg;

const TEST_DB_URL = process.env.CONTRACTS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.CONTRACTS_TEST_RUN_ID;
const SUITE_ID = "governance-owner-nonsuperuser-test";

function buildConnectionStringAs(baseUrl, user, password) {
  const url = new URL(baseUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString();
}

test("governance_owner: ownership transfer reproducible bajo un rol migrador NO superusuario (requiere CONTRACTS_TEST_DATABASE_URL)", { skip: !TEST_DB_URL }, async t => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const MIGRATOR_ROLE = `nx_test_migrator_${suffix}`;
  const RUNTIME_ROLE = `nx_test_runtime_${suffix}`;
  const OWNER_DOUBLE_ROLE = `nx_test_gov_owner_${suffix}`;
  const TEST_SCHEMA = `nx_test_ownership_${suffix}`;
  const PIPELINE_TEST_SCHEMA = `nx_test_pipeline_${suffix}`;
  const MIGRATOR_PASSWORD = randomUUID();
  const RUNTIME_PASSWORD = randomUUID();

  let adminPool;
  let migratorPool;
  let runtimePool;
  let dbName;

  t.before(async () => {
    if (!TEST_RUN_ID) {
      throw new Error("Falta CONTRACTS_TEST_RUN_ID -requerido junto con CONTRACTS_TEST_DATABASE_URL.");
    }
    printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
    adminPool = new Pool({ connectionString: TEST_DB_URL, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
    await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

    dbName = describeConnectionTarget(TEST_DB_URL).database;

    // El superusuario local crea el rol migrador con EXACTAMENTE los
    // privilegios administrativos mínimos que este escenario necesita
    // (CREATEROLE + CREATE en la base, para poder crear el doble de
    // governance_owner, un schema propio y una función de prueba) -
    // deliberadamente NUNCA superuser/createdb, para reproducir el mismo
    // nivel de privilegio que Supabase le da a `postgres`.
    await adminPool.query(`CREATE ROLE ${MIGRATOR_ROLE} WITH LOGIN PASSWORD '${MIGRATOR_PASSWORD}' CREATEROLE`);
    await adminPool.query(`GRANT CREATE ON DATABASE ${dbName} TO ${MIGRATOR_ROLE}`);

    // Rol runtime "de aplicación" sin ningún privilegio administrativo -
    // representa nexus_app_read/requester/worker/rule evaluator para la
    // prueba negativa de SET ROLE.
    await adminPool.query(`CREATE ROLE ${RUNTIME_ROLE} WITH LOGIN PASSWORD '${RUNTIME_PASSWORD}'`);

    migratorPool = new Pool({
      connectionString: buildConnectionStringAs(TEST_DB_URL, MIGRATOR_ROLE, MIGRATOR_PASSWORD),
      application_name: `${SUITE_ID}:migrator:${TEST_RUN_ID}`
    });
    runtimePool = new Pool({
      connectionString: buildConnectionStringAs(TEST_DB_URL, RUNTIME_ROLE, RUNTIME_PASSWORD),
      application_name: `${SUITE_ID}:runtime:${TEST_RUN_ID}`
    });

    // El migrador crea el doble de governance_owner (mismo patrón exacto
    // que sql/089: NOLOGIN, sin password) y su sandbox de prueba -TODAVÍA
    // SIN la membresía SET, a propósito, para el primer subtest.
    await migratorPool.query(`CREATE ROLE ${OWNER_DOUBLE_ROLE} WITH NOLOGIN`);
    await migratorPool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await migratorPool.query(`CREATE FUNCTION ${TEST_SCHEMA}.dummy_fn() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$`);
    // Prerrequisito independiente del fix de SET ROLE, ya existente para el
    // governance_owner real (sql/089: "GRANT USAGE, CREATE ON SCHEMA
    // governance TO governance_owner") - ALTER ... OWNER TO exige que el
    // NUEVO owner tenga CREATE en el schema contenedor, además de que quien
    // ejecuta el ALTER pueda SET ROLE a él. Se replica acá para que el
    // sandbox de prueba sea un espejo fiel del caso real.
    await migratorPool.query(`GRANT CREATE ON SCHEMA ${TEST_SCHEMA} TO ${OWNER_DOUBLE_ROLE}`);
  });

  t.after(async () => {
    // DROP OWNED BY antes de DROP ROLE -el doble de governance_owner puede
    // haber terminado como dueño de la función (ese es justamente el punto
    // probado). CASCADE en el schema se lleva la función sin importar quién
    // sea su dueño en ese momento.
    await adminPool.query(`DROP SCHEMA IF EXISTS ${PIPELINE_TEST_SCHEMA} CASCADE`).catch(() => {});
    await adminPool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => {});
    await adminPool.query(`DROP OWNED BY ${OWNER_DOUBLE_ROLE}`).catch(() => {});
    await adminPool.query(`DROP ROLE IF EXISTS ${OWNER_DOUBLE_ROLE}`).catch(() => {});
    await adminPool.query(`DROP OWNED BY ${MIGRATOR_ROLE}`).catch(() => {});
    await adminPool.query(`DROP ROLE IF EXISTS ${MIGRATOR_ROLE}`).catch(() => {});
    await adminPool.query(`DROP OWNED BY ${RUNTIME_ROLE}`).catch(() => {});
    await adminPool.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`).catch(() => {});
    await migratorPool?.end();
    await runtimePool?.end();
    await adminPool?.end();
  });

  await t.test("REPRODUCCIÓN: sin la membresía SET, el migrador (CREATEROLE, no superuser) NO puede transferir ownership -mismo 42501 real de Supabase", async () => {
    await assert.rejects(
      () => migratorPool.query(`ALTER FUNCTION ${TEST_SCHEMA}.dummy_fn() OWNER TO ${OWNER_DOUBLE_ROLE}`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        assert.match(err.message, /set role/i);
        return true;
      }
    );
  });

  await t.test("mismo mecanismo de sql/089/090 (GRANT ... TO SESSION_USER WITH INHERIT FALSE, SET TRUE) habilita el ownership transfer", async () => {
    await assert.doesNotReject(() =>
      migratorPool.query(`GRANT ${OWNER_DOUBLE_ROLE} TO SESSION_USER WITH INHERIT FALSE, SET TRUE`)
    );
    await assert.doesNotReject(() =>
      migratorPool.query(`ALTER FUNCTION ${TEST_SCHEMA}.dummy_fn() OWNER TO ${OWNER_DOUBLE_ROLE}`)
    );
  });

  await t.test("la función terminó realmente owned por el doble de governance_owner (verificado por el superusuario, no por el migrador)", async () => {
    const { rows } = await adminPool.query(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'dummy_fn' AND pronamespace = $1::regnamespace`,
      [TEST_SCHEMA]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner, OWNER_DOUBLE_ROLE);
  });

  await t.test("el doble de governance_owner sigue NOLOGIN, no-superuser, sin CREATEDB/CREATEROLE -nunca escalado por el fix", async () => {
    // pg_roles.rolpassword SIEMPRE lee como el literal "********" (nunca
    // NULL, para nadie, ver documentación de PostgreSQL) - el chequeo real
    // de "tiene contraseña" exige pg_authid (solo legible por superusuario;
    // adminPool lo es en el Postgres local desechable).
    const { rows } = await adminPool.query(
      `SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
              a.rolpassword IS NOT NULL AS has_password
       FROM pg_roles r JOIN pg_authid a ON a.rolname = r.rolname
       WHERE r.rolname = $1`,
      [OWNER_DOUBLE_ROLE]
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      has_password: false
    });
  });

  await t.test("el propio migrador nunca fue superuser (sanity check del escenario probado)", async () => {
    const { rows } = await adminPool.query(`SELECT rolsuper FROM pg_roles WHERE rolname = $1`, [MIGRATOR_ROLE]);
    assert.equal(rows[0].rolsuper, false);
  });

  await t.test("un rol runtime (sin membresía otorgada) NO puede SET ROLE al doble de governance_owner", async () => {
    await assert.rejects(
      () => runtimePool.query(`SET ROLE ${OWNER_DOUBLE_ROLE}`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        return true;
      }
    );
  });

  // === Segundo caso real: CREATE OR REPLACE FUNCTION sobre un objeto que YA
  // existe y ya quedó owned por governance_owner (nunca transferencia de
  // ownership -eso es el bloque de arriba; esto es sql/098 reemplazando
  // governance._evaluate_rule_into_staging, creada y transferida por sql/090).
  // A este punto dummy_fn() ya está owned por OWNER_DOUBLE_ROLE (subtest de
  // ownership transfer, arriba).

  await t.test("REPRODUCCIÓN (segundo caso real): sin SET ROLE, el migrador NO puede CREATE OR REPLACE una función ya owned por el doble de governance_owner (42501, must be owner)", async () => {
    await assert.rejects(
      () => migratorPool.query(`CREATE OR REPLACE FUNCTION ${TEST_SCHEMA}.dummy_fn() RETURNS void LANGUAGE sql AS $$ SELECT 2 $$`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        assert.match(err.message, /must be owner/i);
        return true;
      }
    );
  });

  await t.test("mismo mecanismo de sql/098 (SET ROLE governance_owner; CREATE OR REPLACE FUNCTION ...; RESET ROLE;) habilita el replace", async () => {
    // Un solo query con las 3 sentencias combinadas, igual a como
    // bootstrap-disposable-postgres.mjs aplica el archivo completo (una
    // sola llamada client.query(ddl) con TODO el contenido del .sql).
    await assert.doesNotReject(() =>
      migratorPool.query(`
        SET ROLE ${OWNER_DOUBLE_ROLE};
        CREATE OR REPLACE FUNCTION ${TEST_SCHEMA}.dummy_fn() RETURNS void LANGUAGE sql AS $$ SELECT 2 $$;
        RESET ROLE;
      `)
    );
  });

  await t.test("la función sigue owned por el doble de governance_owner después del replace (CREATE OR REPLACE nunca cambia el owner) y la nueva definición realmente se aplicó", async () => {
    const { rows } = await adminPool.query(
      `SELECT pg_get_userbyid(proowner) AS owner, prosrc FROM pg_proc WHERE proname = 'dummy_fn' AND pronamespace = $1::regnamespace`,
      [TEST_SCHEMA]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner, OWNER_DOUBLE_ROLE);
    assert.match(rows[0].prosrc, /SELECT 2/);
  });

  await t.test("RESET ROLE restauró la identidad de sesión del migrador -la MISMA conexión vuelve a ser el migrador, nunca queda elevada", async () => {
    const { rows } = await migratorPool.query("SELECT current_user AS u, session_user AS su");
    assert.equal(rows[0].u, MIGRATOR_ROLE);
    assert.equal(rows[0].su, MIGRATOR_ROLE);
  });

  await t.test("(recordatorio) un rol runtime sigue sin poder SET ROLE al doble de governance_owner después del replace -ver subtest dedicado arriba, mismo resultado", async () => {
    await assert.rejects(
      () => runtimePool.query(`SET ROLE ${OWNER_DOUBLE_ROLE}`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        return true;
      }
    );
  });

  // === Tercer caso real: ALTER FUNCTION ... OWNER TO exige que el NUEVO
  // owner tenga CREATE sobre el schema destino, ADEMÁS de la membresía SET
  // (ya probada y ya establecida arriba) - sql/101 transfiriendo
  // pipeline.fn_claim_next_refresh_run et al. a governance_owner, que solo
  // tenía USAGE en `pipeline` (sql/089), nunca CREATE. Schema de prueba
  // NUEVO y todavía SIN el GRANT CREATE -a diferencia de TEST_SCHEMA
  // (arriba), que ya lo tiene desde el primer caso; esto aísla
  // específicamente el requisito de CREATE-en-el-schema, distinto del
  // requisito de SET ROLE ya cubierto.

  await t.test("setup (tercer caso): schema nuevo (aún sin CREATE para el doble de governance_owner) + función creada por el migrador", async () => {
    await migratorPool.query(`CREATE SCHEMA ${PIPELINE_TEST_SCHEMA}`);
    await migratorPool.query(`CREATE FUNCTION ${PIPELINE_TEST_SCHEMA}.pipeline_fn() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$`);
  });

  await t.test("REPRODUCCIÓN (tercer caso real): con la membresía SET ya establecida pero SIN CREATE en el schema destino, el ownership transfer falla -'permission denied for schema', nunca 'must be able to set role' (aísla el requisito distinto)", async () => {
    await assert.rejects(
      () => migratorPool.query(`ALTER FUNCTION ${PIPELINE_TEST_SCHEMA}.pipeline_fn() OWNER TO ${OWNER_DOUBLE_ROLE}`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        assert.match(err.message, /permission denied for schema/i);
        return true;
      }
    );
  });

  await t.test("mismo mecanismo de sql/101 (GRANT CREATE ON SCHEMA ... TO governance_owner) habilita el ownership transfer", async () => {
    await assert.doesNotReject(() => migratorPool.query(`GRANT CREATE ON SCHEMA ${PIPELINE_TEST_SCHEMA} TO ${OWNER_DOUBLE_ROLE}`));
    await assert.doesNotReject(() => migratorPool.query(`ALTER FUNCTION ${PIPELINE_TEST_SCHEMA}.pipeline_fn() OWNER TO ${OWNER_DOUBLE_ROLE}`));
  });

  await t.test("pipeline_fn() terminó realmente owned por el doble de governance_owner (verificado por el superusuario)", async () => {
    const { rows } = await adminPool.query(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'pipeline_fn' AND pronamespace = $1::regnamespace`,
      [PIPELINE_TEST_SCHEMA]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner, OWNER_DOUBLE_ROLE);
  });

  await t.test("el rol runtime NO ganó CREATE en el schema de pipeline ni SET ROLE al doble de governance_owner -el GRANT fue exclusivo del doble, nunca ampliado a roles runtime", async () => {
    await assert.rejects(
      () => runtimePool.query(`CREATE FUNCTION ${PIPELINE_TEST_SCHEMA}.runtime_should_not_create() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        return true;
      }
    );
    await assert.rejects(
      () => runtimePool.query(`SET ROLE ${OWNER_DOUBLE_ROLE}`),
      err => {
        assert.equal(err.code, "42501", `código esperado 42501, recibido ${err.code}: ${err.message}`);
        return true;
      }
    );
  });

  await t.test("el doble de governance_owner conserva sus propiedades restrictivas después de este tercer grant también (NOLOGIN, no-superuser, sin CREATEDB/CREATEROLE)", async () => {
    const { rows } = await adminPool.query(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1`,
      [OWNER_DOUBLE_ROLE]
    );
    assert.deepEqual(rows[0], { rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  });

  // === Aserción global (sql/109): TODAS las funciones SECURITY DEFINER
  // REALES de governance/pipeline (creadas por el árbol sql/*.sql real -
  // 000 a 109, nunca el sandbox sintético de arriba) deben terminar owned
  // por governance_owner, nunca por postgres. Requiere que ESTA corrida
  // haya bootstrapeado el árbol sql/ completo (no el bootstrap vacío usado
  // para las pruebas anteriores) - si no encuentra ninguna función que
  // revisar, falla fuerte en vez de pasar vacíamente, para no poder pasar
  // "por accidente" contra una base sin las migraciones reales aplicadas.

  await t.test("aserción global (sql/109): TODA función SECURITY DEFINER real en governance/pipeline pertenece a governance_owner", async () => {
    const { rows } = await adminPool.query(`
      SELECT n.nspname AS schema, p.proname AS name, pg_get_userbyid(p.proowner) AS owner
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('governance', 'pipeline') AND p.prosecdef = true
      ORDER BY n.nspname, p.proname
    `);
    assert.ok(
      rows.length > 0,
      "se esperaba al menos una función SECURITY DEFINER real en governance/pipeline -¿esta corrida bootstrapeó sql/*.sql completo (000-109), o solo el bootstrap vacío?"
    );
    const misowned = rows.filter(r => r.owner !== "governance_owner");
    assert.deepEqual(
      misowned, [],
      `funciones SECURITY DEFINER que NO pertenecen a governance_owner: ${misowned.map(r => `${r.schema}.${r.name} (owner=${r.owner})`).join(", ")}`
    );
  });

  await t.test("aserción global (sql/109): ninguna función SECURITY DEFINER de governance/pipeline quedó owned por postgres específicamente", async () => {
    const { rows } = await adminPool.query(`
      SELECT n.nspname AS schema, p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('governance', 'pipeline') AND p.prosecdef = true AND pg_get_userbyid(p.proowner) = 'postgres'
    `);
    assert.deepEqual(rows, [], `funciones owned por postgres (deriva no reparada): ${rows.map(r => `${r.schema}.${r.name}`).join(", ")}`);
  });
});
