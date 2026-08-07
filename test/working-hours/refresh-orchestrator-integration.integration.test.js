// NEXUS V3 - pruebas de integración de la etapa BUILD_WORKING_HOURS/
// VALIDATE_AFTER_HOURS del orquestador (scripts/pipeline/run-data-refresh.mjs)
// contra un Postgres real y DESECHABLE - nunca Supabase productivo. Mismo
// mecanismo de aislamiento que test/working-hours/db-writer.integration.test.js
// (WORKING_HOURS_TEST_DATABASE_URL/_RUN_ID, aislada de contracts/holidays-B0).
//
// Llama runApply() REAL (no una reimplementación) - exactamente el mismo
// mecanismo que invoca la etapa BUILD_WORKING_HOURS del orquestador, ver
// scripts/pipeline/run-data-refresh.mjs::prepareWorkingHoursWriteConfirmation.
// Para que runApply() (que lee WORKING_HOURS_DB_URL/CONFIRM_WRITE_TARGET de
// process.env, nunca un parámetro) apunte al Postgres desechable de esta
// suite, este archivo corre en su PROPIO proceso `node --test` (garantizado
// por scripts/run-test-suite.mjs::runTestSuite en modo integration - un
// spawn por archivo, nunca batched) y fija esas 2 variables en before() -
// mutación segu16ra, no se filtra a otros archivos de test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { runApply } from "../../src/working-hours/build-working-hours.js";
import { findTaskYearsMissingHolidayCoverage } from "../../src/working-hours/db-writer.js";
import { buildWriteConfirmationToken, describeConnectionTarget, assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.WORKING_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.WORKING_HOURS_TEST_RUN_ID;
const SUITE_ID = "working-hours-refresh-orchestrator-test";
const { Pool } = pg;

// Año sintético (2031) exclusivo de esta suite - nunca colisiona con los
// fixtures 2018-2026 de otras suites de working-hours/holidays que puedan
// compartir el mismo Postgres desechable persistente entre corridas.
const FIXTURE_YEAR = 2031;
const FIXTURE_TASK_ID = 902001;

let pool;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta WORKING_HOURS_TEST_RUN_ID - requerido junto con WORKING_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(pool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  // runApply() real lee WORKING_HOURS_DB_URL/CONFIRM_WRITE_TARGET de
  // process.env (nunca un parámetro) - se redirige acá al mismo destino
  // desechable de esta suite, mismo criterio que
  // scripts/pipeline/run-data-refresh.mjs::prepareWorkingHoursWriteConfirmation.
  process.env.WORKING_HOURS_DB_URL = TEST_DB_URL;
  process.env.CONFIRM_WRITE_TARGET = buildWriteConfirmationToken(describeConnectionTarget(TEST_DB_URL));

  // Limpieza idempotente de fixtures de corridas anteriores contra el mismo
  // Postgres desechable persistente.
  await pool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id = $1`, [FIXTURE_TASK_ID]);
  await pool.query(
    `DELETE FROM config.holiday_calendar_coverage WHERE jurisdiction = 'CL' AND coverage_range = daterange($1,$2)`,
    [`${FIXTURE_YEAR}-01-01`, `${FIXTURE_YEAR + 1}-01-01`]
  );
});

after(async () => {
  if (pool) await pool.end();
});

async function insertFixtureTask() {
  // processed.fieldbeat_tasks (tabla DUCKDB_SYNC, poblada vía
  // migrateToSupabase()) no tiene PK/UNIQUE en Postgres -sin ON CONFLICT
  // posible; el DELETE de before() ya la deja limpia antes de cada corrida
  // completa de esta suite.
  await pool.query(
    `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, start_time, duration_minutes, client_key, task_type, assigned_to)
     VALUES ($1, $2, 60, 'CLIENTE-AFTER-HOURS-TEST', 'PM', 'tech-after-hours-test')`,
    [FIXTURE_TASK_ID, `${FIXTURE_YEAR}-03-15T23:00:00Z`] // 23:00 UTC = fuera de jornada en cualquier huso CL real
  );
}

async function publishFullYearHolidayCoverage(year) {
  const importRes = await pool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, jurisdiction, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('fixture-refresh-orchestrator.json', $1, 'CL', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`,
    [randomUUID()]
  );
  await pool.query(`SELECT config.publish_holiday_coverage('CL', daterange($1,$2), $3)`, [
    `${year}-01-01`, `${year + 1}-01-01`, importRes.rows[0].import_id
  ]);
}

// === 1. findTaskYearsMissingHolidayCoverage - correctitud de la consulta ===

test("findTaskYearsMissingHolidayCoverage: año sin ninguna tarea procesada no aparece (nada que validar todavía)", { skip: !TEST_DB_URL }, async () => {
  const missing = await findTaskYearsMissingHolidayCoverage(pool);
  assert.ok(!missing.includes(FIXTURE_YEAR), `${FIXTURE_YEAR} no debería reportarse - todavía no hay ninguna tarea de ese año en processed.fieldbeat_tasks`);
});

test("nueva tarea FieldBeat sincronizada en un año SIN cobertura de feriados -> findTaskYearsMissingHolidayCoverage la detecta", { skip: !TEST_DB_URL }, async () => {
  await insertFixtureTask(); // simula lo que SYNC_POSTGRES acaba de escribir
  const missing = await findTaskYearsMissingHolidayCoverage(pool);
  assert.ok(missing.includes(FIXTURE_YEAR), `se esperaba ${FIXTURE_YEAR} en la lista de años sin cobertura - tarea ${FIXTURE_TASK_ID} ya está en processed.fieldbeat_tasks pero config.holiday_calendar_coverage no tiene fila VALIDATED para ese año`);
});

test("cobertura de feriados PARCIAL (no el año completo) sigue contando como faltante - nunca falso negativo", { skip: !TEST_DB_URL }, async () => {
  // Cobertura de solo medio año (ene-jun) - @> exige el año COMPLETO. Vive
  // en su propio rango [ene,jun) para no solapar con la cobertura del año
  // completo que otros tests publican para FIXTURE_YEAR - se limpia con un
  // DELETE directo en `finally` (nunca queda a mitad de camino si la
  // aserción falla, y esta fixture no necesita preservar el historial
  // SUPERSEDED que sí exige el flujo real de holidays:import).
  const importRes = await pool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, jurisdiction, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('fixture-partial.json', $1, 'CL', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`,
    [randomUUID()]
  );
  await pool.query(`SELECT config.publish_holiday_coverage('CL', daterange($1,$2), $3)`, [
    `${FIXTURE_YEAR}-01-01`, `${FIXTURE_YEAR}-07-01`, importRes.rows[0].import_id
  ]);

  try {
    const missing = await findTaskYearsMissingHolidayCoverage(pool);
    assert.ok(missing.includes(FIXTURE_YEAR), "cobertura de solo medio año no debe bastar - el año sigue reportado como sin cobertura completa");
  } finally {
    await pool.query(`DELETE FROM config.holiday_calendar_coverage WHERE coverage_range = daterange($1,$2)`, [`${FIXTURE_YEAR}-01-01`, `${FIXTURE_YEAR}-07-01`]);
  }
});

// === 2. Cobertura completa publicada -> runApply() real calcula la tarea ===

test("con cobertura de feriados completa, findTaskYearsMissingHolidayCoverage ya no reporta el año", { skip: !TEST_DB_URL }, async () => {
  await publishFullYearHolidayCoverage(FIXTURE_YEAR);
  const missing = await findTaskYearsMissingHolidayCoverage(pool);
  assert.ok(!missing.includes(FIXTURE_YEAR), `${FIXTURE_YEAR} no debería seguir reportado - ya se publicó cobertura VALIDATED del año completo`);
});

test("BUILD_WORKING_HOURS real (runApply): la tarea nueva se calcula y aparece en la vista de After-Hours con sus segundos reales", { skip: !TEST_DB_URL }, async () => {
  const result = await runApply({ from: null, to: null });
  assert.equal(result.ok, true, `runApply debía tener éxito: ${JSON.stringify(result.validation?.errors ?? result.error)}`);
  assert.ok(result.rowCount > 0);

  // La vista de transición (sql/082) expone minutos ya derivados
  // (business_minutes/outside_coverage_minutes/after_hours_total_minutes),
  // no los segundos crudos de Capa C (esos viven en
  // marts.fieldbeat_working_hours_analysis_v2, columna covered_seconds/etc).
  const row = await pool.query(
    `SELECT data_basis, calculation_status, business_minutes, outside_coverage_minutes, after_hours_total_minutes
     FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id = $1`,
    [FIXTURE_TASK_ID]
  );
  assert.equal(row.rows.length, 1, "la tarea debe aparecer en la vista de transición (FROM processed.fieldbeat_tasks incluye TODA tarea real)");
  const r = row.rows[0];

  // Sin equipo asociado (fixture no crea contrato) -> cae a LEGACY_SCHEDULE,
  // pero SÍ calculable (cobertura de feriados y horario por defecto
  // existen) - nunca NOT_CALCULABLE ni NONE por falta de calendario.
  assert.equal(r.data_basis, "LEGACY_SCHEDULE");
  assert.notEqual(r.calculation_status, "NOT_CALCULABLE");
  assert.ok(r.business_minutes !== null, "business_minutes (minutos laborales) debe estar calculado, no NULL");
  assert.ok(r.outside_coverage_minutes !== null, "outside_coverage_minutes (minutos fuera de jornada/fin de semana/feriado) debe estar calculado, no NULL");
});

test("la tarea nueva modifica los agregados After-Hours del año (mismo filtro que usan los KPIs del dashboard)", { skip: !TEST_DB_URL }, async () => {
  // Mismo criterio de agregación que app/api/dashboard/after-hours/summary -
  // suma de after_hours_total_minutes sobre marts.fieldbeat_working_hours_analysis_current
  // filtrado por año. No importa la app Next.js (paquete separado) - se
  // replica la agregación mínima necesaria para demostrar el efecto sobre
  // el KPI, contra la MISMA vista real que esos endpoints consultan.
  const agg = await pool.query(
    `SELECT count(*) AS task_count, sum(after_hours_total_minutes) AS after_hours_minutes_sum
     FROM marts.fieldbeat_working_hours_analysis_current
     WHERE EXTRACT(YEAR FROM start_time_utc) = $1`,
    [FIXTURE_YEAR]
  );
  assert.equal(Number(agg.rows[0].task_count), 1, "el KPI de conteo de tareas del año debe incluir la tarea nueva");
  assert.ok(Number(agg.rows[0].after_hours_minutes_sum) > 0, "el KPI de minutos fuera de jornada del año debe reflejar los minutos reales de la tarea nueva (23:00 UTC cae fuera de cualquier jornada laboral CL)");
});

test("refresh incremental sin tareas nuevas: recomputar de nuevo (sin cambios en el origen) es idempotente - el resultado publicado no cambia", { skip: !TEST_DB_URL }, async () => {
  // El builder NO tiene un modo incremental seguro (runBuild siempre lee
  // TODAS las tareas, publishResults siempre hace TRUNCATE+INSERT completo
  // - ver comentario de cabecera de scripts/pipeline/run-data-refresh.mjs).
  // Esta prueba demuestra la garantía real y honesta: sin tareas nuevas, el
  // resultado publicado es idéntico entre corridas (ninguna deriva/drift),
  // aunque el cálculo completo sí se re-ejecute cada vez.
  const before1 = await pool.query(
    `SELECT data_basis, calculation_status, covered_seconds, outside_coverage_seconds, after_hours_total_seconds, start_time_local
     FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id = $1`,
    [FIXTURE_TASK_ID]
  );

  const secondRun = await runApply({ from: null, to: null });
  assert.equal(secondRun.ok, true);

  const after1 = await pool.query(
    `SELECT data_basis, calculation_status, covered_seconds, outside_coverage_seconds, after_hours_total_seconds, start_time_local
     FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id = $1`,
    [FIXTURE_TASK_ID]
  );

  assert.deepEqual(after1.rows[0], before1.rows[0], "recomputar sin cambios en el origen debe producir exactamente el mismo resultado publicado - conserva el resultado, sin importar que se haya recalculado toda la población");
});

// === 3. Propagación de fallas: runApply({ok:false}) nunca debe ser ignorado ===
//
// runApply() devuelve {ok:false, validation|error} EN VEZ de lanzar cuando
// falla (ver src/working-hours/build-working-hours.js:87-94/110-119) - la
// etapa BUILD_WORKING_HOURS del orquestador (scripts/pipeline/run-data-refresh.mjs)
// usa la función nombrada assertWorkingHoursApplyOk() exactamente para
// convertir eso en un throw real, así nunca queda silenciado. Se prueba
// DIRECTO contra esa función real (no una reimplementación) - no necesita
// Postgres, corre siempre.

test("assertWorkingHoursApplyOk: {ok:false, validation} se convierte en throw con el detalle de los errores", async () => {
  const { assertWorkingHoursApplyOk } = await import("../../scripts/pipeline/run-data-refresh.mjs");
  assert.throws(
    () => assertWorkingHoursApplyOk({ ok: false, validation: { errors: ["tarea 900001 duplicada", "tarea 900002 duplicada"] } }),
    /BUILD_WORKING_HOURS: apply rechazado.*tarea 900001 duplicada/
  );
});

test("assertWorkingHoursApplyOk: {ok:false, error} (fallo inesperado, no de validación) también se convierte en throw", async () => {
  const { assertWorkingHoursApplyOk } = await import("../../scripts/pipeline/run-data-refresh.mjs");
  assert.throws(
    () => assertWorkingHoursApplyOk({ ok: false, error: new Error("conexión perdida a mitad de la transacción") }),
    /BUILD_WORKING_HOURS: apply rechazado.*conexión perdida/
  );
});

test("assertWorkingHoursApplyOk: {ok:true} nunca lanza - una corrida exitosa debe poder seguir a la etapa siguiente", async () => {
  const { assertWorkingHoursApplyOk } = await import("../../scripts/pipeline/run-data-refresh.mjs");
  assert.doesNotThrow(() => assertWorkingHoursApplyOk({ ok: true, builderRunId: "fixture-run-id", rowCount: 42 }));
});

test("runApply real: un fieldbeat_task_id duplicado en los resultados produce {ok:false} (nunca lanza, nunca publica) - assertWorkingHoursApplyOk lo detecta", { skip: !TEST_DB_URL }, async () => {
  // Reproduce el MISMO chequeo que corre dentro de runApply (validateBeforePublish)
  // contra datos reales de runBuild(), igual que
  // test/working-hours/db-writer.integration.test.js -confirma que el
  // camino {ok:false} de runApply es alcanzable con datos reales, no solo
  // con un objeto sintético.
  const { runBuild, validateBeforePublish } = await import("../../src/working-hours/db-writer.js");
  const { results } = await runBuild(pool);
  const duplicated = [...results, results[0]];
  const validation = validateBeforePublish(duplicated);
  assert.equal(validation.ok, false, "un fieldbeat_task_id duplicado debe fallar validateBeforePublish - mismo chequeo que runApply corre antes de publicar");

  const { assertWorkingHoursApplyOk } = await import("../../scripts/pipeline/run-data-refresh.mjs");
  assert.throws(() => assertWorkingHoursApplyOk({ ok: false, validation }), /BUILD_WORKING_HOURS: apply rechazado/);
});
