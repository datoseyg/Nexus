// src/db/duckdb-freshness.js - las dos guardas de la etapa LOAD_DUCKDB
// (scripts/pipeline/run-data-refresh.mjs, entre BUILD_GOLD y SYNC_POSTGRES).
//
// Secciones:
//   1. assertDuckDbLoadComplete - unitaria, sin DB.
//   2. assertDuckDbFreshAfterLoad - DuckDB + CSV temporales, sin Postgres.
//   3. Integración real: reproduce el incidente completo (DuckDB desactualizado
//      sincronizado hacia Postgres) y demuestra que LOAD_DUCKDB lo corrige -
//      requiere CONTRACTS_TEST_DATABASE_URL (mismo Postgres desechable que
//      test/db/migrate-to-supabase.ownership.test.js y test/contracts/**).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import pg from "pg";
import { DuckDBInstance } from "@duckdb/node-api";
import { assertDisposableTarget } from "../../src/lib/db-safety.js";
import { loadDuckDb } from "../../src/db/load-duckdb.js";
import { migrateToSupabase } from "../../src/db/migrate-to-supabase.js";
import { assertDuckDbLoadComplete, assertDuckDbFreshAfterLoad, DEFAULT_FRESHNESS_CHECK_KEYS } from "../../src/db/duckdb-freshness.js";

async function withTempDir(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "duckdb-freshness-test-"));
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function withDuckDb(dbPath, options, fn) {
  const instance = await DuckDBInstance.create(dbPath, options);
  const connection = await instance.connect();
  try {
    return await fn(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

// === 1. assertDuckDbLoadComplete - unitaria, sin DB ==========================

test("assertDuckDbLoadComplete: todo LOADED -> no lanza", () => {
  assert.doesNotThrow(() =>
    assertDuckDbLoadComplete([
      { table: "processed.fieldbeat_tasks", csv: "x.csv", status: "LOADED", row_count: 10 },
      { table: "processed.zendesk_tickets", csv: "y.csv", status: "LOADED", row_count: 5 }
    ])
  );
});

test("assertDuckDbLoadComplete: una tabla DUCKDB_SYNC real SKIPPED_MISSING_CSV -> lanza mencionándola", () => {
  assert.throws(
    () =>
      assertDuckDbLoadComplete([
        { table: "processed.fieldbeat_tasks", csv: "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv", status: "SKIPPED_MISSING_CSV" }
      ]),
    /LOAD_DUCKDB.*1 tabla\(s\) DUCKDB_SYNC obligatoria\(s\).*processed\.fieldbeat_tasks.*SKIPPED_MISSING_CSV/s
  );
});

test("assertDuckDbLoadComplete: una tabla DUCKDB_SYNC real con ERROR -> lanza mencionando el detalle del error", () => {
  assert.throws(
    () =>
      assertDuckDbLoadComplete([
        { table: "processed.zendesk_tickets", csv: "x.csv", status: "ERROR", error: "IO Error: boom" }
      ]),
    /processed\.zendesk_tickets.*ERROR: IO Error: boom/s
  );
});

test("assertDuckDbLoadComplete: nunca marca la tabla FAILED por sí sola - solo lanza, no muta el resultado recibido", () => {
  const results = [{ table: "processed.fieldbeat_tasks", csv: "x.csv", status: "SKIPPED_MISSING_CSV" }];
  const snapshot = JSON.stringify(results);
  assert.throws(() => assertDuckDbLoadComplete(results));
  assert.equal(JSON.stringify(results), snapshot, "no debe mutar el array de resultados recibido");
});

test("assertDuckDbLoadComplete: una tabla NO clasificada DUCKDB_SYNC con ERROR -> nunca bloquea (solo las obligatorias)", () => {
  assert.doesNotThrow(() =>
    assertDuckDbLoadComplete([{ table: "marts.tabla_que_no_esta_en_ningun_inventario", csv: "z.csv", status: "ERROR", error: "boom" }])
  );
});

// === 2. assertDuckDbFreshAfterLoad - DuckDB + CSV temporales, sin Postgres ===

test("assertDuckDbFreshAfterLoad: CSV y DuckDB coinciden tras loadDuckDb() -> no lanza, devuelve las claves chequeadas", async () => {
  await withTempDir(async tmpDir => {
    const dbPath = path.join(tmpDir, "test.duckdb");
    const csv = path.join(tmpDir, "tasks.csv");
    await fs.writeFile(csv, "id\n1\n2\n3\n", "utf8");
    const tables = [{ schema: "processed", table: "fieldbeat_tasks", csv }];

    await loadDuckDb({ dbPath, schemas: ["processed"], tables });
    const checked = await assertDuckDbFreshAfterLoad({ dbPath, tables, checkKeys: ["processed.fieldbeat_tasks"] });
    assert.deepEqual(checked, ["processed.fieldbeat_tasks"]);
  });
});

test("assertDuckDbFreshAfterLoad: DuckDB desactualizado respecto al CSV (LOAD_DUCKDB saltado) -> lanza con ambos conteos", async () => {
  await withTempDir(async tmpDir => {
    const dbPath = path.join(tmpDir, "test.duckdb");
    const csv = path.join(tmpDir, "tasks.csv");
    const tables = [{ schema: "processed", table: "fieldbeat_tasks", csv }];

    // Carga inicial "vieja" - 2 filas.
    await fs.writeFile(csv, "id\n1\n2\n", "utf8");
    await loadDuckDb({ dbPath, schemas: ["processed"], tables });

    // BUILD_GOLD reescribe el CSV con 5 filas, pero esta vez NADIE vuelve a
    // llamar loadDuckDb() (exactamente el bug real: SYNC_POSTGRES leería
    // esta tabla con 2 filas en vez de 5).
    await fs.writeFile(csv, "id\n1\n2\n3\n4\n5\n", "utf8");

    await assert.rejects(
      assertDuckDbFreshAfterLoad({ dbPath, tables, checkKeys: ["processed.fieldbeat_tasks"] }),
      /processed\.fieldbeat_tasks \(CSV=5, DuckDB=2\)/
    );
  });
});

test("assertDuckDbFreshAfterLoad: checkKeys vacío o sin coincidencias -> no lanza, no abre el archivo", async () => {
  const checked = await assertDuckDbFreshAfterLoad({
    dbPath: "/ruta/que/no/existe.duckdb",
    tables: [{ schema: "processed", table: "fieldbeat_tasks", csv: "x.csv" }],
    checkKeys: ["processed.otra_tabla_no_incluida"]
  });
  assert.deepEqual(checked, []);
});

test("DEFAULT_FRESHNESS_CHECK_KEYS incluye el mínimo exigido por el encargo", () => {
  assert.deepEqual(
    [...DEFAULT_FRESHNESS_CHECK_KEYS].sort(),
    ["processed.dolibarr_products", "processed.fieldbeat_tasks", "processed.fieldbeat_used_parts", "processed.zendesk_tickets"].sort()
  );
});

// === 3. Integración real: reproduce el incidente completo ====================

const TEST_DB_URL = process.env.CONTRACTS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.CONTRACTS_TEST_RUN_ID;

async function assertOwnershipDisposable(pool) {
  assert.ok(TEST_RUN_ID, "Falta CONTRACTS_TEST_RUN_ID cuando CONTRACTS_TEST_DATABASE_URL está configurada");
  const { hostname } = new URL(TEST_DB_URL);
  await assertDisposableTarget(pool, { expectedRunId: TEST_RUN_ID, expectedUser: "postgres", expectedSuiteId: "duckdb-freshness", host: hostname });
}

async function writeTasksCsv(csvPath, count) {
  const rows = Array.from({ length: count }, (_, i) => `${i + 1}`).join("\n");
  await fs.writeFile(csvPath, `id\n${rows}\n`, "utf8");
}

// Reproduce el incidente real reportado en
// data/reports/supabase_validation_summary.json: "DuckDB antiguo: N filas,
// CSV nuevo: M filas" (acá N=5, M=8 - la mecánica es idéntica a 3747/3791,
// solo se usa una escala pequeña para que el test sea rápido y determinista).
test(
  "integración: DuckDB antiguo + CSV nuevo -> LOAD_DUCKDB dentro de la secuencia real -> DuckDB Y Postgres terminan en el conteo NUEVO",
  { skip: !TEST_DB_URL },
  async t => {
    const adminPool = new pg.Pool({ connectionString: TEST_DB_URL, application_name: `duckdb-freshness:${TEST_RUN_ID}` });
    await assertOwnershipDisposable(adminPool);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "duckdb-freshness-e2e-"));
    const dbPath = path.join(tmpDir, "test.duckdb");
    const csv = path.join(tmpDir, "tasks.csv");
    const tables = [{ schema: "processed", table: "fieldbeat_tasks", csv }];

    t.after(async () => {
      await adminPool.query(`DROP TABLE IF EXISTS processed.fieldbeat_tasks CASCADE`);
      delete process.env.SUPABASE_DB_URL_DIRECT;
      await adminPool.end();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // syncMedallionTables() empareja columnas por NOMBRE entre DuckDB y
    // Postgres (ver src/db/migrate-to-supabase.js::replaceViaStaging) - el
    // shape real de processed.fieldbeat_tasks en producción tiene decenas de
    // columnas que no importan para este test (solo el CONTEO). Mismo
    // recurso que test/db/migrate-to-supabase.ownership.test.js: reemplazar
    // la tabla real, en esta base DESECHABLE, por un shape mínimo compatible
    // con el .duckdb temporal de este test.
    await adminPool.query(`DROP TABLE IF EXISTS processed.fieldbeat_tasks CASCADE`);
    await adminPool.query(`CREATE TABLE processed.fieldbeat_tasks (id integer)`);

    // "DuckDB antiguo": una carga previa con 5 filas.
    await writeTasksCsv(csv, 5);
    await loadDuckDb({ dbPath, schemas: ["processed"], tables });

    // "CSV nuevo": BUILD_GOLD (simulado) reescribe el CSV con 8 filas - el
    // .duckdb sigue teniendo 5 hasta que algo lo recargue.
    await writeTasksCsv(csv, 8);

    // Secuencia real de LOAD_DUCKDB (idéntica a
    // scripts/pipeline/run-data-refresh.mjs) seguida de SYNC_POSTGRES.
    const loadResults = await loadDuckDb({ dbPath, schemas: ["processed"], tables });
    assertDuckDbLoadComplete(loadResults);
    await assertDuckDbFreshAfterLoad({ dbPath, tables, checkKeys: ["processed.fieldbeat_tasks"] });

    process.env.SUPABASE_DB_URL_DIRECT = TEST_DB_URL;
    await migrateToSupabase({ dbPath });

    const duckdbCount = await withDuckDb(dbPath, { access_mode: "READ_ONLY" }, async connection => {
      const reader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM processed.fieldbeat_tasks`);
      return Number(reader.getRowObjects()[0].n);
    });
    const postgresCount = (await adminPool.query(`SELECT COUNT(*)::int AS n FROM processed.fieldbeat_tasks`)).rows[0].n;

    assert.equal(duckdbCount, 8, "DuckDB debe reflejar el CSV nuevo, nunca la carga vieja de 5 filas");
    assert.equal(postgresCount, 8, "Postgres debe reflejar el CSV nuevo, nunca la carga vieja de 5 filas");
  }
);

// Control negativo: reproduce el bug ORIGINAL a propósito (saltando
// loadDuckDb() antes de sincronizar, como pasaba antes de esta corrección)
// para demostrar que sin la etapa LOAD_DUCKDB, Postgres queda desactualizado
// - la misma raíz del incidente real.
test(
  "integración (control negativo): sin recargar DuckDB antes de sincronizar, Postgres queda con el conteo VIEJO (reproduce el bug original)",
  { skip: !TEST_DB_URL },
  async t => {
    const adminPool = new pg.Pool({ connectionString: TEST_DB_URL, application_name: `duckdb-freshness:${TEST_RUN_ID}` });
    await assertOwnershipDisposable(adminPool);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "duckdb-freshness-negctrl-"));
    const dbPath = path.join(tmpDir, "test.duckdb");
    const csv = path.join(tmpDir, "tasks.csv");
    const tables = [{ schema: "processed", table: "fieldbeat_tasks", csv }];

    t.after(async () => {
      await adminPool.query(`DROP TABLE IF EXISTS processed.fieldbeat_tasks CASCADE`);
      delete process.env.SUPABASE_DB_URL_DIRECT;
      await adminPool.end();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // Ver el comentario equivalente en el test anterior - mismo shape mínimo.
    await adminPool.query(`DROP TABLE IF EXISTS processed.fieldbeat_tasks CASCADE`);
    await adminPool.query(`CREATE TABLE processed.fieldbeat_tasks (id integer)`);

    await writeTasksCsv(csv, 5);
    await loadDuckDb({ dbPath, schemas: ["processed"], tables });
    await writeTasksCsv(csv, 8); // CSV nuevo escrito, pero NUNCA recargado a propósito

    process.env.SUPABASE_DB_URL_DIRECT = TEST_DB_URL;
    await migrateToSupabase({ dbPath }); // sin loadDuckDb() ni assertDuckDbFreshAfterLoad() de por medio

    const postgresCount = (await adminPool.query(`SELECT COUNT(*)::int AS n FROM processed.fieldbeat_tasks`)).rows[0].n;
    assert.equal(postgresCount, 5, "sin LOAD_DUCKDB, Postgres sincroniza el .duckdb desactualizado (5), nunca el CSV nuevo (8) - esto es el bug real que motivó la corrección");
  }
);
