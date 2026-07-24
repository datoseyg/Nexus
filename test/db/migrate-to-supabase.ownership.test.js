import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import pg from "pg";
import { DuckDBInstance } from "@duckdb/node-api";
import * as ownershipManifest from "../../src/db/ownership-manifest.js";
import { assertDisposableTarget } from "../../src/lib/db-safety.js";
import { TABLES } from "../../src/db/warehouse-config.js";
import { assertNoUnknownTables, buildAtomicReplaceSql, buildNamedColumnInsert, syncMedallionTables } from "../../src/db/migrate-to-supabase.js";

const { getOwnership, isDuckdbSync, OWNERSHIP } = ownershipManifest;

// === Unitarias, sin DB ===

test("marts.fieldbeat_working_hours_analysis (mart legado) -> EXTERNAL, nunca DUCKDB_SYNC", () => {
  assert.equal(getOwnership("marts", "fieldbeat_working_hours_analysis"), OWNERSHIP.EXTERNAL);
  assert.equal(isDuckdbSync("marts", "fieldbeat_working_hours_analysis"), false);
});

test("una entrada real de warehouse-config.js::TABLES -> DUCKDB_SYNC", () => {
  const [{ schema, table }] = TABLES;
  assert.equal(getOwnership(schema, table), OWNERSHIP.DUCKDB_SYNC);
  assert.equal(isDuckdbSync(schema, table), true);
});

test("Capa B/C de ETAPA 6.6B0 -> POSTGRES_BUILDER, nunca DUCKDB_SYNC", () => {
  assert.equal(getOwnership("marts", "fieldbeat_contract_coverage_segments"), OWNERSHIP.POSTGRES_BUILDER);
  assert.equal(getOwnership("marts", "fieldbeat_working_hours_analysis_v2"), OWNERSHIP.POSTGRES_BUILDER);
  assert.equal(getOwnership("marts", "fieldbeat_working_hours_equipment_links"), OWNERSHIP.POSTGRES_BUILDER);
  assert.equal(isDuckdbSync("marts", "fieldbeat_working_hours_analysis_v2"), false);
});

test("config.*/manual_review.* -> POSTGRES_TRANSACTIONAL", () => {
  assert.equal(getOwnership("config", "contract_equipment_versions"), OWNERSHIP.POSTGRES_TRANSACTIONAL);
  assert.equal(getOwnership("config", "holiday_calendar_entries"), OWNERSHIP.POSTGRES_TRANSACTIONAL);
  assert.equal(getOwnership("config", "holiday_calendar_coverage"), OWNERSHIP.POSTGRES_TRANSACTIONAL);
  assert.equal(getOwnership("manual_review", "contract_data_issues"), OWNERSHIP.POSTGRES_TRANSACTIONAL);
});

test("tabla EXTERNAL conocida queda declarada de forma explícita", () => {
  assert.equal(getOwnership("gold", "after_hours_by_client"), OWNERSHIP.EXTERNAL);
});

test("vista Postgres-native -> VIEW_NOT_APPLICABLE", () => {
  assert.equal(OWNERSHIP.VIEW_NOT_APPLICABLE, "VIEW_NOT_APPLICABLE");
  assert.equal(getOwnership("marts", "fieldbeat_working_hours_analysis_current", "view"), OWNERSHIP.VIEW_NOT_APPLICABLE);
});

test("objeto desconocido produce clasificación diagnóstica, nunca EXTERNAL implícito", () => {
  assert.equal(typeof ownershipManifest.classifyOwnership, "function", "falta la interfaz classifyOwnership");
  assert.deepEqual(
    ownershipManifest.classifyOwnership("marts", "una_tabla_que_no_existe_en_ningun_inventario"),
    {
      key: "marts.una_tabla_que_no_existe_en_ningun_inventario",
      schema: "marts",
      name: "una_tabla_que_no_existe_en_ningun_inventario",
      kind: "table",
      known: false,
      ownership: null,
      requiredColumns: []
    }
  );
  assert.equal(isDuckdbSync("marts", "una_tabla_que_no_existe_en_ningun_inventario"), false);
});

test("no-drift: toda entrada de TABLES clasifica DUCKDB_SYNC", () => {
  for (const { schema, table } of TABLES) {
    assert.equal(getOwnership(schema, table), OWNERSHIP.DUCKDB_SYNC, `${schema}.${table} debería ser DUCKDB_SYNC`);
  }
});

test("manifiesto rechaza una segunda categoría para el mismo objeto", () => {
  assert.equal(typeof ownershipManifest.assertUniqueOwnershipEntries, "function");
  assert.throws(
    () => ownershipManifest.assertUniqueOwnershipEntries([
      { kind: "table", key: "marts.demo", ownership: OWNERSHIP.DUCKDB_SYNC },
      { kind: "table", key: "marts.demo", ownership: OWNERSHIP.EXTERNAL }
    ]),
    /ownership duplicado.*table:marts\.demo/
  );
});

test("preflight rechaza objetos desconocidos antes de cualquier escritura", () => {
  assert.throws(
    () => assertNoUnknownTables([
      { table_schema: "processed", table_name: TABLES[0].table },
      { table_schema: "marts", table_name: "drift_sin_clasificar" }
    ]),
    /OBJETOS DESCONOCIDOS.*marts\.drift_sin_clasificar/
  );
});

test("INSERT enumera columnas por nombre y no depende del orden físico de Postgres", () => {
  assert.equal(
    buildNamedColumnInsert("processed", "demo", ["id", "label", "select"]),
    'INSERT INTO pg."processed"."demo" ("id", "label", "select") SELECT "id", "label", "select" FROM "processed"."demo"'
  );
});

test("swap staging reemplaza la tabla publicada dentro de una sola transacción", () => {
  const sql = buildAtomicReplaceSql("processed", "demo", "_nexus_stage_demo", ["id", "label"]);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /TRUNCATE TABLE "processed"\."demo" RESTART IDENTITY;/);
  assert.doesNotMatch(sql, /CASCADE/);
  assert.match(sql, /INSERT INTO "processed"\."demo" \("id", "label"\) SELECT "id", "label" FROM "processed"\."_nexus_stage_demo";/);
  assert.match(sql, /DROP TABLE "processed"\."_nexus_stage_demo";/);
  assert.match(sql, /COMMIT;$/);
});

// === Integración real: syncMedallionTables() con DuckDB + Postgres reales ===
// Reutiliza CONTRACTS_TEST_DATABASE_URL (mismo Postgres desechable que
// test/contracts/**), nunca corre contra Supabase productivo.
const TEST_DB_URL = process.env.CONTRACTS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.CONTRACTS_TEST_RUN_ID;

async function assertOwnershipDisposable(pool) {
  assert.ok(TEST_RUN_ID, "Falta CONTRACTS_TEST_RUN_ID cuando CONTRACTS_TEST_DATABASE_URL está configurada");
  const { hostname } = new URL(TEST_DB_URL);
  await assertDisposableTarget(pool, {
    expectedRunId: TEST_RUN_ID,
    expectedUser: "postgres",
    expectedSuiteId: "ownership-manifest",
    host: hostname
  });
}

test("integración: objeto desconocido aborta antes de truncar y EXTERNAL nunca se toca", { skip: !TEST_DB_URL }, async t => {
  const adminPool = new pg.Pool({ connectionString: TEST_DB_URL, application_name: `ownership-manifest:${TEST_RUN_ID}` });
  await assertOwnershipDisposable(adminPool);

  // Nombres de prueba aislados en el schema real `marts` (syncMedallionTables
  // está hardcodeado a SYNC_SCHEMAS=['processed','marts','gold'], no se puede
  // probar contra un schema inventado) -distintos de los objetos reales de
  // 6.6B0 para no interferir con ddl.integration.test.js en la misma base.
  const SYNC_TABLE = "ownership_test_sync_me";
  const EXTERNAL_TABLE = "fieldbeat_working_hours_analysis"; // nombre real -override EXTERNAL del manifiesto

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wh-ownership-"));
  const duckdbPath = path.join(tmpDir, "test.duckdb");

  t.after(async () => {
    await adminPool.query(`DROP TABLE IF EXISTS marts.${SYNC_TABLE}`);
    await adminPool.query(`TRUNCATE TABLE marts.${EXTERNAL_TABLE}`);
    await adminPool.end();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Postgres: crear la tabla "sincronizable" de prueba; la EXTERNAL_TABLE ya
  // existe de verdad (bootstrap del mart legado, 28 columnas) -se deja vacía
  // y se confirma que sigue vacía después de correr el migrador.
  await adminPool.query(`DROP TABLE IF EXISTS marts.${SYNC_TABLE}`);
  await adminPool.query(`CREATE TABLE marts.${SYNC_TABLE} (id integer, label text)`);
  await adminPool.query(`INSERT INTO marts.${SYNC_TABLE} VALUES (99, 'debe sobrevivir')`);
  await adminPool.query(`TRUNCATE TABLE marts.${EXTERNAL_TABLE}`);

  // DuckDB: mismo par de tablas, con datos -SYNC_TABLE tiene 2 filas,
  // EXTERNAL_TABLE (shape mínimo, JAMÁS se intenta un INSERT real hacia el
  // lado Postgres de 28 columnas si el filtro funciona -eso es justamente
  // lo que se está probando) tiene 1 fila.
  const instance = await DuckDBInstance.create(duckdbPath, { access_mode: "READ_WRITE" });
  const connection = await instance.connect();
  await connection.run(`CREATE SCHEMA IF NOT EXISTS marts`);
  await connection.run(`CREATE TABLE marts.${SYNC_TABLE} (id INTEGER, label TEXT)`);
  await connection.run(`INSERT INTO marts.${SYNC_TABLE} VALUES (1, 'a'), (2, 'b')`);
  await connection.run(`CREATE TABLE marts.${EXTERNAL_TABLE} (id INTEGER)`);
  await connection.run(`INSERT INTO marts.${EXTERNAL_TABLE} VALUES (1)`);

  await connection.run("INSTALL postgres");
  await connection.run("LOAD postgres");
  await connection.run(`ATTACH '${TEST_DB_URL}' AS pg (TYPE postgres)`);

  await assert.rejects(syncMedallionTables(connection), /OBJETOS DESCONOCIDOS.*marts\.ownership_test_sync_me/);
  connection.closeSync();

  const unknownRows = await adminPool.query(`SELECT id, label FROM marts.${SYNC_TABLE}`);
  assert.deepEqual(unknownRows.rows, [{ id: 99, label: "debe sobrevivir" }], "el preflight debe ocurrir antes de cualquier TRUNCATE");

  const externalRows = await adminPool.query(`SELECT COUNT(*)::int AS n FROM marts.${EXTERNAL_TABLE}`);
  assert.equal(externalRows.rows[0].n, 0, "la tabla EXTERNAL (mart legado) nunca debe recibir datos del migrador");
});

test("integración: SYNC_TABLE real (registrada en TABLES) sí se sincroniza; EXTERNAL nunca", { skip: !TEST_DB_URL }, async t => {
  // Variante que usa un nombre REALMENTE registrado en TABLES para
  // demostrar el camino DUCKDB_SYNC=true de punta a punta, no solo el
  // camino de omisión. Se elige la primera entrada de TABLES y se replica
  // su {schema,table} con un shape trivial propio de este test -el shape
  // real de esa tabla en producción no importa acá, DuckDB y Postgres son
  // ambos desechables/aislados.
  const [{ schema, table }] = TABLES;
  assert.equal(schema, "processed", "ajustar el test si la primera entrada de TABLES cambia de schema");

  const adminPool = new pg.Pool({ connectionString: TEST_DB_URL, application_name: `ownership-manifest:${TEST_RUN_ID}` });
  await assertOwnershipDisposable(adminPool);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wh-ownership-2-"));
  const duckdbPath = path.join(tmpDir, "test.duckdb");

  t.after(async () => {
    await adminPool.query(`DROP TABLE IF EXISTS ${schema}.${table}`);
    await adminPool.end();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  await adminPool.query(`DROP TABLE IF EXISTS ${schema}.${table}`);
  await adminPool.query(`CREATE TABLE ${schema}.${table} (id integer, label text)`);

  const instance = await DuckDBInstance.create(duckdbPath, { access_mode: "READ_WRITE" });
  const connection = await instance.connect();
  await connection.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await connection.run(`CREATE TABLE ${schema}.${table} (id INTEGER, label TEXT)`);
  await connection.run(`INSERT INTO ${schema}.${table} VALUES (1, 'x'), (2, 'y'), (3, 'z')`);

  await connection.run("INSTALL postgres");
  await connection.run("LOAD postgres");
  await connection.run(`ATTACH '${TEST_DB_URL}' AS pg (TYPE postgres)`);

  const result = await syncMedallionTables(connection);
  connection.closeSync();

  assert.ok(result.migrated >= 1, `se esperaba al menos 1 tabla migrada, resultado: ${JSON.stringify(result)}`);

  const rows = await adminPool.query(`SELECT COUNT(*)::int AS n FROM ${schema}.${table}`);
  assert.equal(rows.rows[0].n, 3, "la tabla DUCKDB_SYNC real debe recibir las 3 filas vía TRUNCATE+INSERT");
});
