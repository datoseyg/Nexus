// loadDuckDb() (src/db/load-duckdb.js) contra un .duckdb y unos CSV
// temporales y aislados - nunca toca data/warehouse/eyg_nexus.duckdb ni
// data/processed/**/*.csv reales. Sin Postgres (a diferencia de
// test/db/duckdb-freshness.test.js, que sí necesita CONTRACTS_TEST_DATABASE_URL
// para su escenario end-to-end).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadDuckDb } from "../../src/db/load-duckdb.js";

async function withTempDir(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "load-duckdb-test-"));
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function countRows(dbPath, schema, table) {
  const instance = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${schema}.${table}`);
    return Number(reader.getRowObjects()[0].n);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

// Regresión real (ver el incidente que motivó test/db/duckdb-freshness.test.js):
// CREATE OR REPLACE TABLE debe reemplazar el contenido COMPLETO en cada
// corrida, nunca acumular filas de una carga anterior ni conservarlas si el
// CSV cambió de tamaño.
test("loadDuckDb: una segunda corrida con un CSV más grande reemplaza el contenido completo (nunca acumula filas viejas)", async () => {
  await withTempDir(async tmpDir => {
    const dbPath = path.join(tmpDir, "test.duckdb");
    const csv = path.join(tmpDir, "stale_refresh.csv");
    const tables = [{ schema: "processed", table: "stale_refresh_demo", csv }];

    await fs.writeFile(csv, "id,name\n1,a\n2,b\n", "utf8");
    const firstLoad = await loadDuckDb({ dbPath, schemas: ["processed"], tables });
    assert.deepEqual(firstLoad, [{ table: "processed.stale_refresh_demo", csv, status: "LOADED", row_count: 2 }]);
    assert.equal(await countRows(dbPath, "processed", "stale_refresh_demo"), 2);

    // Simula BUILD_GOLD escribiendo un CSV nuevo y más grande antes de la
    // segunda carga - el escenario real del incidente (3747 -> 3791 tareas).
    await fs.writeFile(csv, "id,name\n1,a\n2,b\n3,c\n", "utf8");
    const secondLoad = await loadDuckDb({ dbPath, schemas: ["processed"], tables });
    assert.deepEqual(secondLoad, [{ table: "processed.stale_refresh_demo", csv, status: "LOADED", row_count: 3 }]);
    assert.equal(await countRows(dbPath, "processed", "stale_refresh_demo"), 3, "el conteo debe reflejar el CSV nuevo, nunca quedar en el valor de la carga anterior");
  });
});

test("loadDuckDb: CSV faltante -> SKIPPED_MISSING_CSV, nunca lanza por sí sola", async () => {
  await withTempDir(async tmpDir => {
    const dbPath = path.join(tmpDir, "test.duckdb");
    const missingCsv = path.join(tmpDir, "no_existe.csv");
    const tables = [{ schema: "processed", table: "missing_demo", csv: missingCsv }];

    const results = await loadDuckDb({ dbPath, schemas: ["processed"], tables });
    assert.deepEqual(results, [{ table: "processed.missing_demo", csv: missingCsv, status: "SKIPPED_MISSING_CSV" }]);
  });
});

test("loadDuckDb: al menos una tabla con ERROR hace que la función lance (falla completa, nunca parcial en silencio)", async () => {
  await withTempDir(async tmpDir => {
    const dbPath = path.join(tmpDir, "test.duckdb");
    // Un directorio en vez de un CSV real - read_csv_auto falla al leerlo.
    const badCsvPath = path.join(tmpDir, "not_a_csv_dir");
    await fs.mkdir(badCsvPath);
    const tables = [{ schema: "processed", table: "broken_demo", csv: badCsvPath }];

    await assert.rejects(loadDuckDb({ dbPath, schemas: ["processed"], tables }), /tabla\(s\) fallaron al cargar/);
  });
});

test("loadDuckDb: default (sin argumentos) sigue apuntando al warehouse real - solo se verifica la firma, nunca se invoca así en este test", () => {
  assert.equal(loadDuckDb.length, 0, "loadDuckDb debe seguir aceptando cero argumentos (todos los parámetros son opcionales)");
});
