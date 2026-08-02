// Unitaria, sin DB - la secuencia de etapas de scripts/pipeline/run-data-refresh.mjs.
// La cobertura de COMPORTAMIENTO de LOAD_DUCKDB (que realmente corrige un
// .duckdb desactualizado) vive en test/db/duckdb-freshness.test.js - este
// archivo cubre específicamente que la etapa exista y esté en la posición
// correcta de la SECUENCIA, para que un PR que borre
// `await enterStage("LOAD_DUCKDB")` de ese orquestador (sin tocar
// duckdb-freshness.js) también falle un test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../../scripts/pipeline/run-data-refresh.mjs";

test("STAGES incluye LOAD_DUCKDB exactamente entre BUILD_GOLD y SYNC_POSTGRES", () => {
  const buildGoldIndex = STAGES.indexOf("BUILD_GOLD");
  const loadDuckDbIndex = STAGES.indexOf("LOAD_DUCKDB");
  const syncPostgresIndex = STAGES.indexOf("SYNC_POSTGRES");

  assert.notEqual(buildGoldIndex, -1, "falta BUILD_GOLD en STAGES");
  assert.notEqual(loadDuckDbIndex, -1, "falta LOAD_DUCKDB en STAGES - sin esta etapa, SYNC_POSTGRES puede migrar un .duckdb desactualizado (ver test/db/duckdb-freshness.test.js)");
  assert.notEqual(syncPostgresIndex, -1, "falta SYNC_POSTGRES en STAGES");

  assert.equal(loadDuckDbIndex, buildGoldIndex + 1, "LOAD_DUCKDB debe ir INMEDIATAMENTE después de BUILD_GOLD");
  assert.equal(syncPostgresIndex, loadDuckDbIndex + 1, "SYNC_POSTGRES debe ir INMEDIATAMENTE después de LOAD_DUCKDB");
});

test("STAGES es la secuencia completa esperada, en orden, sin duplicados", () => {
  assert.deepEqual(STAGES, [
    "EXTRACT", "NORMALIZE", "BUILD_MARTS", "BUILD_GOLD", "LOAD_DUCKDB", "SYNC_POSTGRES",
    "BUILD_WORKING_HOURS", "VALIDATE_AFTER_HOURS", "VALIDATE", "REEVALUATE_RULES", "PUBLISH_SNAPSHOT"
  ]);
  assert.equal(new Set(STAGES).size, STAGES.length, "no debe haber nombres de etapa duplicados");
});
