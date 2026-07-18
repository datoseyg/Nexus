// ETAPA 6.5.1.1 (2ª ronda) - sql/085 nunca inventa un superseded_at
// histórico: si encuentra filas is_current=false preexistentes (escritas
// por código anterior a esta migración, cuando la columna no existía),
// debe abortar con un mensaje claro en vez de fallar con un error de
// constraint críptico o adivinar un valor. Contra Postgres 16 DESECHABLE
// -nunca Supabase productivo, nunca nexus-afterhours-realdata2. Se salta
// entera si CONTRACTS_TEST_DATABASE_URL no está seteada. A propósito NO
// aplica sql/085 en su before() -eso es exactamente lo que cada test aplica
// (o no) según el escenario.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.CONTRACTS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.CONTRACTS_TEST_RUN_ID;
const SUITE_ID = "contracts-085-precondition-test";

// Mismo override que src/contracts/db-client.js -sin esto, pg devuelve DATE
// como objeto Date (String(Date) da "Tue Jun 01 2026...", no "2021-06-01").
const { Pool, types } = pg;
types.setTypeParser(1082, value => value);
let adminPool;
let migration085Sql;

test("ETAPA 6.5.1.1 - sql/085 no inventa superseded_at histórico (requiere CONTRACTS_TEST_DATABASE_URL)", { skip: !TEST_DB_URL }, async t => {
  before(async () => {
    if (!TEST_RUN_ID) {
      throw new Error("Falta CONTRACTS_TEST_RUN_ID -requerido junto con CONTRACTS_TEST_DATABASE_URL.");
    }
    printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
    adminPool = new Pool({ connectionString: TEST_DB_URL, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
    await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

    await adminPool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await adminPool.query("CREATE SCHEMA IF NOT EXISTS manual_review");
    await adminPool.query("CREATE SCHEMA IF NOT EXISTS processed");
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app') THEN
          CREATE ROLE nexus_app WITH LOGIN PASSWORD 'test';
        END IF;
      END $$;
    `);
    // Deliberadamente SOLO 070 + 084 -nunca 085 acá. Cada subtest decide si
    // y cuándo aplicar 085.
    await adminPool.query(await fs.readFile("sql/070_config.sql", "utf8"));
    await adminPool.query(await fs.readFile("sql/084_contract_valid_from_correction.sql", "utf8"));
    migration085Sql = await fs.readFile("sql/085_contract_version_revision_uniqueness.sql", "utf8");
  });

  after(async () => {
    await adminPool.query("DROP SCHEMA IF EXISTS config CASCADE");
    await adminPool.query("DROP TABLE IF EXISTS manual_review.contract_data_issues CASCADE");
    await adminPool.query("DROP SCHEMA IF EXISTS processed CASCADE");
    await adminPool.end();
  });

  await t.test("fila is_current=false preexistente (modelo viejo, sin superseded_at) -> sql/085 aborta con mensaje claro, ROLLBACK completo, nada inventado", async () => {
    const importInsert = await adminPool.query(
      `INSERT INTO config.contract_import_runs (source_filename, source_sha256, effective_date, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
       VALUES ('legacy.csv','legacy-sha', '2021-06-01', 1,1,0,0,'SUCCESS') RETURNING import_id`
    );
    const importId = importInsert.rows[0].import_id;

    try {
      // Simula EXACTAMENTE lo que el código pre-6.5.1.1 dejaba: una revisión
      // is_current=false con valid_to seteado (bajo el modelo viejo), sin
      // superseded_at (la columna no existía todavía).
      await adminPool.query(
        `INSERT INTO config.contract_equipment_versions
           (equipment_key, client_name_canonical, client_name_raw, equipment_model,
            installation_date_precision, contract_status_code, spa_tier_code,
            support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
            warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
            valid_to, is_current, normalization_status,
            source_import_id, source_row_number, source_row_hash, contract_fingerprint)
         VALUES
           ('SN:LEGACY001','Cliente Legacy','Cliente Legacy','ModeloLegacy',
            'MONTH','ACTIVE_AUTO_RENEW','GOLD',
            'REMOTE','FULL_COVERAGE','NO','YES','YES',
            'NONE','2020-01-01','INSTALLATION_DATE_INFERRED','MONTH',
            '2021-06-01', false, 'OK',
            $1, 1, 'hash-legacy', 'fp-legacy-old')`,
        [importId]
      );

      await assert.rejects(
        () => adminPool.query(migration085Sql),
        /no puede inferir de forma segura|no inventa superseded_at histórico/
      );

      // Nada se aplicó -ROLLBACK completo dentro del propio archivo (BEGIN/COMMIT).
      const columnExists = await adminPool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='config' AND table_name='contract_equipment_versions' AND column_name='superseded_at'`
      );
      assert.equal(columnExists.rows.length, 0, "superseded_at NUNCA se agregó -toda la migración se revirtió, no quedó a medio aplicar");

      const legacyRow = await adminPool.query(
        `SELECT is_current, valid_to FROM config.contract_equipment_versions WHERE equipment_key = 'SN:LEGACY001'`
      );
      assert.equal(legacyRow.rows[0].is_current, false, "la fila preexistente no fue tocada");
      assert.equal(legacyRow.rows[0].valid_to, "2021-06-01", "valid_to preexistente intacto -nada fue inventado ni sobrescrito");

      const oldConstraintStillThere = await adminPool.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'config.contract_equipment_versions'::regclass AND conname = 'contract_equipment_versions_check'`
      );
      assert.equal(oldConstraintStillThere.rows.length, 1, "el CHECK viejo (is_current=(valid_to IS NULL)) sigue ahí -085 no llegó a tocarlo, transacción abortada antes");
    } finally {
      // Limpieza SIEMPRE, incluso si alguna aserción de arriba falla -para
      // no contaminar los subtests siguientes con esta fila legacy.
      await adminPool.query(`DELETE FROM config.contract_equipment_versions WHERE equipment_key = 'SN:LEGACY001'`);
      await adminPool.query(`DELETE FROM config.contract_import_runs WHERE import_id = $1`, [importId]);
    }
  });

  await t.test("sin filas is_current=false preexistentes -> sql/085 aplica limpio (caso normal, base nueva)", async () => {
    await assert.doesNotReject(() => adminPool.query(migration085Sql));

    const columnExists = await adminPool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='config' AND table_name='contract_equipment_versions' AND column_name='superseded_at'`
    );
    assert.equal(columnExists.rows.length, 1);

    const newCheck = await adminPool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'config.contract_equipment_versions'::regclass AND conname = 'contract_equipment_versions_current_supersede_consistency'`
    );
    assert.equal(newCheck.rows[0].def, "CHECK ((is_current = (superseded_at IS NULL)))", "el CHECK is_current=(superseded_at IS NULL) queda vigente");
  });

  await t.test("sql/085 es idempotente incluso con datos reales presentes (no solo esquema vacío)", async () => {
    // A esta altura la migración ya se aplicó (subtest anterior) y no hay
    // filas is_current=false sin superseded_at -reaplicar debe ser un no-op limpio.
    await assert.doesNotReject(() => adminPool.query(migration085Sql));
    await assert.doesNotReject(() => adminPool.query(migration085Sql));
  });
});
