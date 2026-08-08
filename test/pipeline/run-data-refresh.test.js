// Unitaria, sin DB - la secuencia de etapas de scripts/pipeline/run-data-refresh.mjs.
// La cobertura de COMPORTAMIENTO de LOAD_DUCKDB (que realmente corrige un
// .duckdb desactualizado) vive en test/db/duckdb-freshness.test.js - este
// archivo cubre específicamente que la etapa exista y esté en la posición
// correcta de la SECUENCIA, para que un PR que borre
// `await enterStage("LOAD_DUCKDB")` de ese orquestador (sin tocar
// duckdb-freshness.js) también falle un test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  STAGES,
  checkRefreshRunClaimMatchesExpectation,
  claimRefreshRunById,
  claimRefreshRunByIdOnPool,
  claimNextRefreshRun
} from "../../scripts/pipeline/run-data-refresh.mjs";

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

// checkRefreshRunClaimMatchesExpectation - correlación explícita del puente
// NEXUS V3 (POST /api/data-refresh/runs -> workflow_dispatch), defensa en
// profundidad ADEMÁS del índice único parcial
// refresh_runs_one_active_per_environment (sql/101). Función pura, sin DB -
// la cobertura de qué pasa cuando SÍ hay DB real (fn_fail_refresh_run
// marcando DISPATCH_CORRELATION_MISMATCH) vive en
// test/pipeline/refresh-runs.integration.test.ts.

test("checkRefreshRunClaimMatchesExpectation: sin id esperado (dispatch manual, sin refresh_run_id) -> siempre ok, sin importar qué se reclamó", () => {
  const claim = { claimed: true, refreshRunId: "11111111-1111-1111-1111-111111111111" };
  assert.deepEqual(checkRefreshRunClaimMatchesExpectation(claim, null), { ok: true });
  assert.deepEqual(checkRefreshRunClaimMatchesExpectation(claim, undefined), { ok: true });
  assert.deepEqual(checkRefreshRunClaimMatchesExpectation(claim, ""), { ok: true });
});

test("checkRefreshRunClaimMatchesExpectation: id esperado coincide con lo reclamado -> ok", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const claim = { claimed: true, refreshRunId: id };
  assert.deepEqual(checkRefreshRunClaimMatchesExpectation(claim, id), { ok: true });
});

test("checkRefreshRunClaimMatchesExpectation: id esperado NO coincide con lo reclamado -> ok:false, razón menciona ambos ids", () => {
  const expected = "11111111-1111-1111-1111-111111111111";
  const claimed = "22222222-2222-2222-2222-222222222222";
  const result = checkRefreshRunClaimMatchesExpectation({ claimed: true, refreshRunId: claimed }, expected);
  assert.equal(result.ok, false);
  assert.match(result.reason, new RegExp(claimed));
  assert.match(result.reason, new RegExp(expected));
});

// Blocker de revisión de producto - "correlación debe reclamar por ID, no
// claim-next-then-check": main() debe reclamar EXACTAMENTE por refresh_run_id
// (pipeline.fn_claim_refresh_run_by_id, sql/110) cuando el dispatch trae
// --expected-refresh-run-id, y SOLO en ese caso - el dispatch manual/
// emergencia (sin ese flag) debe seguir usando fn_claim_next_refresh_run sin
// cambios. main() abre pools reales y no es unitariamente invocable sin DB
// (por diseño - ver test/pipeline/data-refresh-dispatch.integration.test.ts
// y test/pipeline/claim-refresh-run-by-id.integration.test.ts para la
// cobertura de comportamiento real); esto es una red de regresión barata,
// sin DB, sobre la ESTRUCTURA de la rama: que exista el `if` correcto y que
// llame a la función correcta en cada rama, para que un futuro refactor que
// vuelva a mezclar ambos caminos falle un test incluso sin correr Postgres.
test("claimRefreshRunById/claimRefreshRunByIdOnPool/claimNextRefreshRun están exportados como funciones (superficie que main() necesita)", () => {
  assert.equal(typeof claimRefreshRunById, "function");
  assert.equal(typeof claimRefreshRunByIdOnPool, "function");
  assert.equal(typeof claimNextRefreshRun, "function");
});

test("main(): el reclamo automático (--expected-refresh-run-id) usa claimRefreshRunById; el manual (sin ese flag) usa claimNextRefreshRun - nunca mezclados", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(__dirname, "..", "..", "scripts", "pipeline", "run-data-refresh.mjs"), "utf8");

  const mainStart = src.indexOf("async function main()");
  assert.ok(mainStart >= 0, "no se encontró main() - run-data-refresh.mjs cambió de forma inesperada");
  const mainBody = src.slice(mainStart);

  const ifIndex = mainBody.indexOf("if (args.expectedRefreshRunId)");
  const elseIndex = mainBody.indexOf("} else {", ifIndex);
  assert.ok(ifIndex >= 0 && elseIndex >= 0, "main() debe ramificar explícitamente sobre args.expectedRefreshRunId");

  const automaticBranch = mainBody.slice(ifIndex, elseIndex);
  const manualBranchEnd = mainBody.indexOf("\n  }\n", elseIndex);
  const manualBranch = mainBody.slice(elseIndex, manualBranchEnd >= 0 ? manualBranchEnd : undefined);

  assert.match(automaticBranch, /claimRefreshRunById\(/, "el camino automático (con --expected-refresh-run-id) debe reclamar por ID exacto");
  assert.doesNotMatch(automaticBranch, /claimNextRefreshRun\(/, "el camino automático NUNCA debe caer a claim-next - eso reclamaría una corrida que este dispatch no pidió");

  assert.match(manualBranch, /claimNextRefreshRun\(/, "el camino manual/emergencia (sin --expected-refresh-run-id) debe conservar claim-next, sin cambios");
  assert.doesNotMatch(manualBranch, /claimRefreshRunById\(/, "el camino manual nunca debe reclamar por un ID exacto que nadie pidió");
});
