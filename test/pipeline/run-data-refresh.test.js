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
  claimNextRefreshRun,
  buildPipelineSslConfig,
  assertNoPipelineConnectionStringSslOverrides,
  prepareAndAuthorizeWorkingHoursWrite,
  assertWorkingHoursApplyOk
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

// buildPipelineSslConfig/assertNoPipelineConnectionStringSslOverrides -
// blocker de revisión de producto: withPool() (el ÚNICO lugar de este
// archivo que crea un pg.Pool) no pasaba ningún objeto `ssl` explícito, así
// que TLS quedaba a merced de lo que la connection string trajera implícito
// (o nada). Cubre TODOS los callers reales de withPool automáticamente
// (governanceWorkerDbUrl, governanceRequesterDbUrl, governanceRuleEvaluatorDbUrl,
// workingHoursDbUrl) - funciones puras, sin DB, sin abrir ningún socket.

const REMOTE_URL = "postgresql://user:pass@some-remote-postgres.example.com:5432/postgres";
const REMOTE_SUPABASE_URL = "postgresql://postgres:pw@db.v3projectref.supabase.co:5432/postgres";

test("buildPipelineSslConfig (1,2): localhost/127.0.0.1 -> false, mismo concepto de host local que src/working-hours/db-client.js", () => {
  assert.equal(buildPipelineSslConfig("postgresql://user:pass@localhost:5432/db"), false);
  assert.equal(buildPipelineSslConfig("postgresql://user:pass@127.0.0.1:5432/db"), false);
});

test("buildPipelineSslConfig (3): host remoto -> { rejectUnauthorized: true }, sin `ca` explícita (se apoya en NODE_EXTRA_CA_CERTS)", () => {
  const config = buildPipelineSslConfig(REMOTE_URL);
  assert.deepEqual(config, { rejectUnauthorized: true });
  assert.equal(Object.prototype.hasOwnProperty.call(config, "ca"), false);
});

test("buildPipelineSslConfig (4): ningún host remoto produce rejectUnauthorized:false", () => {
  for (const url of [REMOTE_URL, REMOTE_SUPABASE_URL, "postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres"]) {
    const config = buildPipelineSslConfig(url);
    assert.notEqual(config, false, `${url} debe exigir TLS`);
    assert.equal(config.rejectUnauthorized, true);
  }
});

test("buildPipelineSslConfig (5,10): connection string inválida falla explícito y seguro, el mensaje nunca incluye password/usuario/URL completa", () => {
  const bogus = "postgresql://secretuser:secretpassword@";
  assert.throws(() => buildPipelineSslConfig("no-es-una-url"), (err) => {
    assert.match(err.message, /connection string inválida/);
    assert.doesNotMatch(err.message, /secretuser|secretpassword/);
    return true;
  });
  assert.throws(() => buildPipelineSslConfig(bogus), (err) => {
    assert.doesNotMatch(err.message, /secretuser|secretpassword/);
    return true;
  });
});

// --- 6-9: parámetros SSL en la connection string -> rechazados ------------
test("assertNoPipelineConnectionStringSslOverrides (6): ?sslmode= -> rechazado, mensaje nombra solo el parámetro", () => {
  assert.throws(() => assertNoPipelineConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslmode=require"), (err) => {
    assert.match(err.message, /sslmode/);
    assert.doesNotMatch(err.message, /user:pass@host/);
    return true;
  });
});

test("assertNoPipelineConnectionStringSslOverrides (7): ?sslrootcert= -> rechazado", () => {
  assert.throws(() => assertNoPipelineConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslrootcert=/tmp/ca.pem"), /sslrootcert/);
});

test("assertNoPipelineConnectionStringSslOverrides (8): ?sslcert= -> rechazado", () => {
  assert.throws(() => assertNoPipelineConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslcert=/tmp/client.crt"), /sslcert/);
});

test("assertNoPipelineConnectionStringSslOverrides (9): ?sslkey= -> rechazado", () => {
  assert.throws(() => assertNoPipelineConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslkey=/tmp/client.key"), /sslkey/);
});

test("assertNoPipelineConnectionStringSslOverrides: detecta el parámetro sin importar mayúsculas/minúsculas", () => {
  assert.throws(() => assertNoPipelineConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?SSLMODE=verify-ca"), /sslmode/);
});

test("assertNoPipelineConnectionStringSslOverrides: connection string normal, sin esos parámetros -> no lanza", () => {
  assert.doesNotThrow(() => assertNoPipelineConnectionStringSslOverrides(REMOTE_URL));
  assert.doesNotThrow(() => assertNoPipelineConnectionStringSslOverrides("postgresql://user:pass@localhost:5432/db"));
});

test("assertNoPipelineConnectionStringSslOverrides (10): connection string inválida -> falla explícito, nunca expone la URL/credenciales", () => {
  assert.throws(() => assertNoPipelineConnectionStringSslOverrides("no-es-una-url"), (err) => {
    assert.match(err.message, /connection string inválida/);
    return true;
  });
});

// --- 11: withPool() usa el helper TLS (verificación estructural - withPool
// no está exportado, por diseño: solo se invoca con connection strings
// reales del propio orquestador, nunca pensado para llamarse suelto desde
// fuera - mismo criterio que el test de main() más arriba) --------------
test("withPool() (11): construye el Pool con ssl: buildPipelineSslConfig(connectionString), y valida overrides ANTES de crear el Pool", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(__dirname, "..", "..", "scripts", "pipeline", "run-data-refresh.mjs"), "utf8");

  const fnStart = src.indexOf("async function withPool(connectionString, applicationName, fn)");
  assert.ok(fnStart >= 0, "no se encontró withPool() - run-data-refresh.mjs cambió de forma inesperada");
  const fnEnd = src.indexOf("\n}\n", fnStart);
  const body = src.slice(fnStart, fnEnd);

  const assertIndex = body.indexOf("assertNoPipelineConnectionStringSslOverrides(connectionString)");
  const poolIndex = body.indexOf("new pg.Pool(");
  assert.ok(assertIndex >= 0, "withPool() debe validar overrides SSL");
  assert.ok(poolIndex >= 0, "withPool() debe seguir creando el Pool acá (único lugar de todo el archivo)");
  assert.ok(assertIndex < poolIndex, "la validación de overrides SSL debe ocurrir ANTES de crear el Pool");

  const poolCallRange = body.slice(poolIndex, body.indexOf(");", poolIndex));
  assert.match(poolCallRange, /ssl:\s*buildPipelineSslConfig\(connectionString\)/, "el Pool debe usar exactamente ssl: buildPipelineSslConfig(connectionString)");
  assert.doesNotMatch(poolCallRange, /rejectUnauthorized:\s*false/, "withPool() nunca debe volver a un ssl fijo/débil inline");
});

test("run-data-refresh.mjs (8): 'new pg.Pool'/'new pg.Client' aparecen EXACTAMENTE una vez en todo el archivo (dentro de withPool) - ninguna otra conexión remota puede quedar sin el helper TLS", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(__dirname, "..", "..", "scripts", "pipeline", "run-data-refresh.mjs"), "utf8");

  const poolMatches = [...src.matchAll(/new pg\.Pool\(/g)];
  const clientMatches = [...src.matchAll(/new pg\.Client\(/g)];
  assert.equal(poolMatches.length, 1, "debe haber exactamente una construcción de pg.Pool en todo el archivo (dentro de withPool)");
  assert.equal(clientMatches.length, 0, "este orquestador nunca debe crear un pg.Client suelto por fuera de withPool");
});

// --- 12: guards/confirmaciones productivas existentes siguen intactos -----
// (comportamiento REAL ya cubierto por sus propios tests dedicados -
// test/lib/supabase-write-guard-wiring.test.js para prepareAndAuthorizeWorkingHoursWrite,
// los tests de checkRefreshRunClaimMatchesExpectation más arriba en este
// mismo archivo- esto es solo la superficie: que buildPipelineSslConfig/
// assertNoPipelineConnectionStringSslOverrides se agregaron JUNTO a esos
// guards, nunca en su lugar).
test("guards de escritura protegida (12): prepareAndAuthorizeWorkingHoursWrite/assertWorkingHoursApplyOk siguen exportados sin cambios - el TLS de withPool es ortogonal (SUPABASE_DB_URL_DIRECT nunca pasa por withPool, ver migrateToSupabase)", () => {
  assert.equal(typeof prepareAndAuthorizeWorkingHoursWrite, "function");
  assert.equal(typeof assertWorkingHoursApplyOk, "function");
  assert.equal(typeof buildPipelineSslConfig, "function");
  assert.equal(typeof assertNoPipelineConnectionStringSslOverrides, "function");
});

// CONTRACT_CONFIGURATION_EMPTY - blocker de producción NEXUS V3: antes de
// este cambio, una corrida con config.contract_equipment_versions vacía
// (contracts:import nunca ejecutado en el entorno) terminaba SUCCEEDED con
// Horas Fuera de Jornada degradado al 100% a LEGACY_SCHEDULE, sin que nadie
// lo notara. Verificación estructural (sin DB) de que VALIDATE_AFTER_HOURS
// llama a countCurrentContractVersions y lanza con el token correcto -
// la cobertura de COMPORTAMIENTO real (contra Postgres desechable) vive en
// test/working-hours/refresh-orchestrator-integration.integration.test.js.
test("VALIDATE_AFTER_HOURS: llama a countCurrentContractVersions y lanza con el token CONTRACT_CONFIGURATION_EMPTY si el conteo es 0, DESPUÉS del chequeo de feriados existente", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(__dirname, "..", "..", "scripts", "pipeline", "run-data-refresh.mjs"), "utf8");

  const stageStart = src.indexOf('await enterStage("VALIDATE_AFTER_HOURS")');
  assert.ok(stageStart >= 0, "no se encontró la etapa VALIDATE_AFTER_HOURS - run-data-refresh.mjs cambió de forma inesperada");
  const stageEnd = src.indexOf('await enterStage("VALIDATE")', stageStart);
  assert.ok(stageEnd >= 0, "no se encontró el inicio de la etapa VALIDATE siguiente - no se pudo acotar el cuerpo de VALIDATE_AFTER_HOURS");
  const stageBody = src.slice(stageStart, stageEnd);

  const holidayThrowIndex = stageBody.indexOf("falta calendario de feriados");
  const contractCallIndex = stageBody.indexOf("countCurrentContractVersions");
  const contractThrowIndex = stageBody.indexOf("CONTRACT_CONFIGURATION_EMPTY");
  assert.ok(holidayThrowIndex >= 0, "el chequeo de feriados existente debe seguir intacto en esta etapa");
  assert.ok(contractCallIndex >= 0, "VALIDATE_AFTER_HOURS debe llamar a countCurrentContractVersions");
  assert.ok(contractThrowIndex >= 0, "VALIDATE_AFTER_HOURS debe lanzar con el token CONTRACT_CONFIGURATION_EMPTY");
  assert.ok(holidayThrowIndex < contractCallIndex, "el chequeo de contratos debe ir DESPUÉS del chequeo de feriados existente, nunca reemplazarlo ni anteponerse");

  assert.match(stageBody, /if\s*\(\s*currentContractVersionCount\s*===\s*0\s*\)\s*\{/, "debe ser una comparación exacta a 0 (ausencia total) - nunca un umbral/porcentaje de cobertura");
  assert.match(stageBody, /CONTRACT_CONFIGURATION_EMPTY[\s\S]{0,120}is_current=true/, "el mensaje debe nombrar is_current=true - no cualquier historial contractual, sólo vigencia actual");

  // El token debe sobrevivir sanitizeErrorSummary (primera línea, .slice(0,500))
  // - se extrae el string literal completo del throw y se valida standalone.
  const throwMatch = stageBody.match(/"VALIDATE_AFTER_HOURS: CONTRACT_CONFIGURATION_EMPTY[\s\S]*?"\s*\)\s*;/);
  assert.ok(throwMatch, "no se pudo extraer el literal completo del throw de CONTRACT_CONFIGURATION_EMPTY");
  const concatenatedMessage = [...throwMatch[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]).join("");
  assert.ok(!concatenatedMessage.includes("\\n"), "el mensaje debe ser una sola línea lógica - sanitizeErrorSummary corta en el primer salto de línea");
  assert.ok(concatenatedMessage.length <= 500, `el mensaje debe caber en 500 caracteres para no perder texto con sanitizeErrorSummary (longitud actual: ${concatenatedMessage.length})`);
  assert.ok(concatenatedMessage.indexOf("CONTRACT_CONFIGURATION_EMPTY") < 100, "el token debe estar cerca del principio del mensaje, nunca después del corte de 500 caracteres");
});
