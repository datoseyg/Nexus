// Pruebas de integración contra un Postgres real y DESECHABLE -nunca
// Supabase productivo. Se saltan enteras si CONTRACTS_TEST_DATABASE_URL no
// está seteada (no deben fallar `npm run contracts:test` en un entorno sin
// acceso a DB).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.CONTRACTS_TEST_DATABASE_URL;
// ETAPA SAFETY-1 - run_id sembrado por scripts/bootstrap-disposable-postgres.mjs.
// applyContracts() YA queda protegido internamente (Caso G), pero este
// before() escribe DDL/DML PROPIO antes de siquiera llamar a
// applyContracts() -necesita su propia verificación primero.
const TEST_RUN_ID = process.env.CONTRACTS_TEST_RUN_ID;
const SUITE_ID = "contracts-db-writer-test";

if (TEST_DB_URL) {
  // db-client.js (usado por applyContracts) lee SUPABASE_DB_URL_DIRECT -se
  // apunta al Postgres de prueba SOLO para esta corrida de proceso, nunca
  // se toca .env.
  process.env.SUPABASE_DB_URL_DIRECT = TEST_DB_URL;
}

const { Pool } = pg;
let adminPool;
let applyContracts;

function makeFixtureCsv(overrides = {}) {
  const base = {
    cliente: "Cliente Prueba",
    abreviacion: "CP",
    equipo: "ModeloX",
    serie: "999001",
    anio: "ene-2020",
    estado: "Vigente (Ren. Automática) (E&G)",
    spa: "Gold (Incluye todos los repuestos)",
    lunVie: "Sí",
    sabDom: "No",
    soporte: "Remoto",
    horarios: "24/7",
    hwRefresh: "No",
    updates: "Sí",
    upgrades: "Sí",
    repuestos: "Todo Incluído",
    qmant: "2",
    notas: ""
  };
  const f = { ...base, ...overrides };
  const header = "Cliente,Abreviación,Equipo,S-N,Año Instalación,Estado Contrato,SPA con Elekta,Lun - Vie,Sab - Dom,Soporte Elekta,Horarios de Atención,HW Refresh,UpDates,UpGrades,Situación Repuestos,Q Mant Prev x Año,Notas,,,,,,,Variables(no considerar para analisis)";
  const row = `${f.cliente},${f.abreviacion},${f.equipo},${f.serie},${f.anio},${f.estado},${f.spa},${f.lunVie},${f.sabDom},${f.soporte},${f.horarios},${f.hwRefresh},${f.updates},${f.upgrades},${f.repuestos},${f.qmant},${f.notas},,,,,,,`;
  return `${header}\n${row}\n`;
}

async function writeFixture(name, content) {
  const dir = "test/contracts/.tmp-fixtures";
  await fs.mkdir(dir, { recursive: true });
  const filePath = `${dir}/${name}`;
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

test("integración db-writer (requiere CONTRACTS_TEST_DATABASE_URL)", { skip: !TEST_DB_URL }, async t => {
  before(async () => {
    if (!TEST_RUN_ID) {
      throw new Error(`Falta CONTRACTS_TEST_RUN_ID -requerido junto con CONTRACTS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).`);
    }
    printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
    adminPool = new Pool({ connectionString: TEST_DB_URL, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
    await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

    await adminPool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await adminPool.query("CREATE SCHEMA IF NOT EXISTS manual_review");
    await adminPool.query("CREATE SCHEMA IF NOT EXISTS processed");
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS processed.fieldbeat_equipments (
        equipment_key TEXT, equipment_uuid TEXT, internal_id TEXT, client_key TEXT, equipment_type TEXT, source_system TEXT, updated_at TIMESTAMPTZ
      )
    `);
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS processed.fieldbeat_clients (
        client_key TEXT, client_name TEXT, rut TEXT, fieldbeat_client_name TEXT, address_raw TEXT, city TEXT, commune TEXT, country TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, updated_at TIMESTAMPTZ
      )
    `);

    const ddl = await fs.readFile("sql/070_config.sql", "utf8");
    // REVOKE/GRANT a nexus_app -el rol no existe en este Postgres
    // desechable; se crea antes de aplicar el DDL para que esas sentencias
    // no fallen (mismo patrón que sql/000_roles_and_schemas.sql).
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app') THEN
          CREATE ROLE nexus_app WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
        END IF;
      END $$;
    `);
    await adminPool.query(ddl);
    // ETAPA 6.5.1 (sql/084_contract_valid_from_correction.sql) agregó
    // valid_from_is_inferred/valid_from_basis/valid_from_precision/
    // valid_from_source_field/valid_from_source_value_raw a
    // config.contract_equipment_versions -VERSION_INSERT_SQL en db-writer.js
    // ya las usa. Este fixture solo aplicaba 070_config.sql, así que
    // aplicar() fallaba con "column does not exist" en TODO intento real de
    // apply, sin relación con la lógica de matching (bug pre-existente,
    // confirmado idéntico contra el baseline f08896f antes de ETAPA
    // 6.5.2B1). 084 es autocontenido -solo agrega columnas/constraint a
    // esta misma tabla, ya creada por 070- por eso alcanza con aplicarlo
    // acá también, sin reordenar nada más.
    const validFromDdl = await fs.readFile("sql/084_contract_valid_from_correction.sql", "utf8");
    await adminPool.query(validFromDdl);

    // ETAPA 6.5.1.1 - corrige el UNIQUE(equipment_key, valid_from) global
    // (sql/070) que impedía dos revisiones autoritativas distintas del
    // mismo período (ej. una corrección de registro Gold->Silver, mismo
    // valid_from) -ver sql/085 y el reporte de esta etapa. Debe aplicarse
    // DESPUÉS de 070+084 (070 crea la tabla y el constraint viejo que 085
    // reemplaza, 084 agrega las columnas valid_from_basis que 085 verifica
    // como precondición).
    const versionUniquenessDdl = await fs.readFile("sql/085_contract_version_revision_uniqueness.sql", "utf8");
    await adminPool.query(versionUniquenessDdl);

    applyContracts = (await import("../../src/contracts/db-writer.js")).applyContracts;
  });

  after(async () => {
    await adminPool.query("DROP SCHEMA IF EXISTS config CASCADE");
    await adminPool.query("DROP TABLE IF EXISTS manual_review.contract_data_issues CASCADE");
    await adminPool.query("DROP SCHEMA IF EXISTS processed CASCADE");
    await adminPool.end();
  });

  await t.test("apply real inserta import_run SUCCESS + versión + observación + match + schedule/windows", async () => {
    await adminPool.query(
      `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key) VALUES ('K1','u1','Linac-999001','C1')`
    );
    await adminPool.query(`INSERT INTO processed.fieldbeat_clients (client_key, client_name) VALUES ('C1','Cliente Prueba')`);

    const filePath = await writeFixture("fixture1.csv", makeFixtureCsv());
    const result = await applyContracts({ file: filePath, effectiveDate: "2026-01-01" });

    assert.equal(result.alreadyImported, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].versionAction, "NEW");
    assert.equal(result.results[0].matchStatus, "MATCHED");

    const versions = await adminPool.query("SELECT * FROM config.contract_equipment_versions WHERE equipment_key = 'SN:999001'");
    assert.equal(versions.rows.length, 1);
    assert.equal(versions.rows[0].is_current, true);

    const schedules = await adminPool.query("SELECT * FROM config.contract_service_schedules WHERE contract_version_id = $1", [versions.rows[0].contract_version_id]);
    assert.equal(schedules.rows.length, 1);
    const windows = await adminPool.query("SELECT * FROM config.contract_service_windows WHERE schedule_id = $1", [schedules.rows[0].schedule_id]);
    assert.equal(windows.rows.length, 7); // 24/7

    const observations = await adminPool.query("SELECT * FROM config.contract_equipment_observations WHERE equipment_key = 'SN:999001'");
    assert.equal(observations.rows.length, 1);

    const matches = await adminPool.query("SELECT * FROM config.contract_equipment_matches");
    assert.equal(matches.rows.length, 1);
    assert.equal(matches.rows[0].match_status, "MATCHED");
  });

  await t.test("idempotencia: aplicar el MISMO archivo de nuevo -> already imported, cero filas nuevas", async () => {
    const filePath = await writeFixture("fixture1.csv", makeFixtureCsv());
    const before1 = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions");

    const result = await applyContracts({ file: filePath, effectiveDate: "2026-01-01" });
    assert.equal(result.alreadyImported, true);

    const after1 = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions");
    assert.equal(before1.rows[0].count, after1.rows[0].count);
  });

  await t.test("fila sin cambios (mismo fingerprint) -> UNCHANGED, sin nueva versión", async () => {
    // notas distinta (cosmético, sin patrón de garantía) -> cambia el SHA-256
    // del archivo (no es un duplicado exacto) pero NO cambia el
    // contract_fingerprint, exactamente el caso que versioning.js debe
    // resolver como UNCHANGED.
    const filePath = await writeFixture("fixture1-unchanged.csv", makeFixtureCsv({ notas: "Nota cosmética sin efecto analítico" }));
    const before1 = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions WHERE equipment_key = 'SN:999001'");

    const result = await applyContracts({ file: filePath, effectiveDate: "2026-02-01" });
    assert.equal(result.results[0].versionAction, "UNCHANGED");

    const after1 = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions WHERE equipment_key = 'SN:999001'");
    assert.equal(before1.rows[0].count, after1.rows[0].count);

    // Pero SÍ debe existir una nueva observation para esta 2da importación real.
    const observations = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_observations WHERE equipment_key = 'SN:999001'");
    assert.equal(Number(observations.rows[0].count), 2);
  });

  await t.test("cambio real de campo (SPA) -> SUPERSEDE, nueva versión, misma vigencia de negocio (ETAPA 6.5.1.1: superseded_at marca la revisión, valid_to NUNCA se toca sin evidencia de fin de vigencia real)", async () => {
    const filePath = await writeFixture("fixture1-changed.csv", makeFixtureCsv({ spa: "Silver (Sólo Soporte)" }));
    const result = await applyContracts({ file: filePath, effectiveDate: "2026-03-01" });
    assert.equal(result.results[0].versionAction, "SUPERSEDE");

    const versions = await adminPool.query(
      "SELECT * FROM config.contract_equipment_versions WHERE equipment_key = 'SN:999001' ORDER BY contract_version_id"
    );
    assert.equal(versions.rows.length, 2);
    // Gold (revisión reemplazada): ya no autoritativa, pero su vigencia de
    // NEGOCIO no cambió -valid_to permanece NULL, solo superseded_at marca
    // el reemplazo de REGISTRO.
    assert.equal(versions.rows[0].is_current, false);
    assert.equal(versions.rows[0].valid_to, null);
    assert.ok(versions.rows[0].superseded_at, "superseded_at debe quedar seteado al reemplazar la revisión");
    // Silver (revisión autoritativa nueva): mismo valid_from que Gold -
    // exactamente el caso que sql/085 habilita.
    assert.equal(versions.rows[1].is_current, true);
    assert.equal(versions.rows[1].superseded_at, null);
    assert.equal(versions.rows[1].spa_tier_code, "SILVER");
    assert.equal(versions.rows[1].valid_from, versions.rows[0].valid_from, "misma vigencia de negocio (mismo valid_from), solo cambia el contenido registrado");
  });

  await t.test("effective_date <= valid_from vigente -> FATAL, rollback completo + FAILED registrado", async () => {
    // ETAPA 6.5.1.1: effectiveDate debe ser realmente <= valid_from de la
    // revisión vigente (2020-01-01, derivado de "ene-2020" en el fixture
    // base, sin cambios) para disparar FATAL_BACKDATED de verdad. ANTES de
    // esta etapa, este subtest usaba effectiveDate="2026-01-01" (posterior a
    // valid_from) y "pasaba" solo porque el archivo coincidía con el mismo
    // bug de UNIQUE(equipment_key, valid_from) que rompía los subtests 4 y
    // 6 -cualquier rechazo satisfacía el assert.rejects() genérico, sin
    // probar realmente la rama FATAL_BACKDATED. Con sql/085 aplicado ese
    // bug ya no existe, así que ahora se verifica explícitamente que el
    // motivo del rechazo es el backdating, no cualquier otro error.
    const filePath = await writeFixture("fixture1-backdated.csv", makeFixtureCsv({ spa: "Sin SPA (Fuera registros Elekta)" }));
    const before1 = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions");

    await assert.rejects(() => applyContracts({ file: filePath, effectiveDate: "2019-06-01" }), /FATAL/);

    const after1 = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions");
    assert.equal(before1.rows[0].count, after1.rows[0].count); // nada nuevo, rollback completo

    const failedRuns = await adminPool.query("SELECT * FROM config.contract_import_runs WHERE import_status = 'FAILED' ORDER BY imported_at DESC LIMIT 1");
    assert.equal(failedRuns.rows.length, 1);
  });

  await t.test("un intento FAILED no bloquea reintentar el mismo archivo con una fecha válida", async () => {
    // El archivo del intento FAILED anterior (fixture1-backdated.csv) tiene
    // un SHA distinto al ya importado -se reintenta con effective_date
    // válida (posterior a valid_from=2020-01-01 Y a la última revisión
    // autoritativa) y debe aplicarse limpio (SUPERSEDE sobre Silver).
    const filePath = "test/contracts/.tmp-fixtures/fixture1-backdated.csv";
    const result = await applyContracts({ file: filePath, effectiveDate: "2026-04-01" });
    assert.equal(result.alreadyImported, false);
    assert.equal(result.results[0].versionAction, "SUPERSEDE");
  });

  await t.test("advisory lock: dos applyContracts() REALMENTE concurrentes del mismo archivo no duplican nada", async () => {
    const filePath = await writeFixture("fixture-lock.csv", makeFixtureCsv({ serie: "555001", cliente: "Cliente Lock" }));

    const [r1, r2] = await Promise.all([
      applyContracts({ file: filePath, effectiveDate: "2026-05-01" }),
      applyContracts({ file: filePath, effectiveDate: "2026-05-01" })
    ]);

    // Exactamente uno de los dos debe haber hecho el trabajo real; el otro
    // debe haber esperado el advisory lock y luego visto "already imported".
    const alreadyImportedFlags = [r1.alreadyImported, r2.alreadyImported].sort();
    assert.deepEqual(alreadyImportedFlags, [false, true]);

    const versions = await adminPool.query("SELECT COUNT(*) FROM config.contract_equipment_versions WHERE equipment_key = 'SN:555001'");
    assert.equal(Number(versions.rows[0].count), 1);
  });

  await t.test("grants: nexus_app solo puede SELECT las vistas, nada más en config/manual_review.contract_data_issues", async () => {
    const nexusPool = new Pool({ connectionString: TEST_DB_URL.replace(/\/\/[^@]+@/, "//nexus_app:__SET_IN_SUPABASE_DASHBOARD__@") });
    try {
      const viewResult = await nexusPool.query("SELECT * FROM config.contract_equipment_analysis LIMIT 1");
      assert.ok(viewResult); // SELECT sobre la vista funciona

      await assert.rejects(() => nexusPool.query("SELECT * FROM config.contract_equipment_versions LIMIT 1"));
      await assert.rejects(() => nexusPool.query("SELECT * FROM config.contract_source_rows LIMIT 1"));
      await assert.rejects(() => nexusPool.query("SELECT * FROM manual_review.contract_data_issues LIMIT 1"));
      await assert.rejects(() => nexusPool.query("INSERT INTO config.contract_equipment_versions DEFAULT VALUES"));
    } finally {
      await nexusPool.end();
    }
  });
});
