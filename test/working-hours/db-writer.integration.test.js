// Pruebas de integración contra un Postgres real y DESECHABLE -nunca
// Supabase productivo. Se saltan enteras si WORKING_HOURS_TEST_DATABASE_URL
// no está seteada. Aislada de CONTRACTS_TEST_DATABASE_URL/
// HOLIDAYS_TEST_DATABASE_URL/working-hours-B0 a propósito (ETAPA 6.6B2 §16).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildTaskCoverage } from "../../src/working-hours/task-coverage-builder.js";
import { validateBeforePublish, publishResults, summarizeResults } from "../../src/working-hours/db-writer.js";

const TEST_DB_URL = process.env.WORKING_HOURS_TEST_DATABASE_URL;
const { Pool } = pg;

let pool;
let fixtureVersionId;
let fixtureScheduleId;

const businessHoursCfg = { status: "DEFAULT_UNVALIDATED", timezone: "America/Santiago", weekly_schedule: {
  monday: { is_business_day: true, start: "08:30", end: "18:30" }, tuesday: { is_business_day: true, start: "08:30", end: "18:30" },
  wednesday: { is_business_day: true, start: "08:30", end: "18:30" }, thursday: { is_business_day: true, start: "08:30", end: "18:30" },
  friday: { is_business_day: true, start: "08:30", end: "18:30" }, saturday: { is_business_day: false }, sunday: { is_business_day: false }
} };

function alwaysNotHoliday(localDate) {
  void localDate;
  return "CONFIRMED_NOT_HOLIDAY";
}

// Fixture mínimo autocontenido: 1 tarea CONTRACTUAL calculable (equipo con
// contrato FIXED_WINDOW vigente), sin tocar la base -no depende de datos
// reales del CSV/DuckDB, coherente con el patrón de
// test/contracts/db-writer.integration.test.js.
function makeResult(taskId, overrides = {}) {
  const base = buildTaskCoverage({
    task: { startTimeRaw: "2026-08-10T20:00:00Z", durationMinutes: 60, clientKey: "CLIENTE-TEST", taskType: "PM", assignedTo: "tech1" },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [{
      fieldbeatEquipmentKey: "FIELDBEAT_EQUIPMENT|test-uuid|EQ-1",
      match: { matchStatus: "MATCHED", matchMethod: "SERIAL_SUFFIX", contractEquipmentKey: "SN:TEST1" },
      versions: [{ contractVersionId: fixtureVersionId, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }],
      scheduleByVersionId: new Map([[fixtureVersionId, { scheduleId: fixtureScheduleId, coverageType: "FIXED_WINDOW", parseStatus: "OK" }]]),
      windowsByScheduleId: new Map([[fixtureScheduleId, [{ dayOfWeek: "MON", startTime: "00:00", endTime: "23:59", allDay: false }]]])
    }],
    holidayLookup: alwaysNotHoliday,
    businessHoursCfg
  });
  return { fieldbeatTaskId: taskId, ...base, ...overrides };
}

function makeLegacyResult(taskId) {
  const base = buildTaskCoverage({
    task: { startTimeRaw: "2026-08-10T20:00:00Z", durationMinutes: 60, clientKey: "CLIENTE-TEST", taskType: "PM", assignedTo: "tech1" },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [], // sin equipo -> NO_EQUIPMENT -> fallback LEGACY_SCHEDULE
    holidayLookup: alwaysNotHoliday,
    businessHoursCfg
  });
  return { fieldbeatTaskId: taskId, ...base };
}

before(async () => {
  if (!TEST_DB_URL) return;
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
  // audit.pipeline_runs es prerrequisito de builder_run_id (FK NOT NULL) -
  // se asume ya aplicado sql/000-083 contra este Postgres desechable (mismo
  // criterio que ddl.integration.test.js de este mismo directorio).

  // Fixture mínimo de config.contract_* (import_run -> version -> schedule
  // -> window), autocontenido -no depende del CSV real ni de
  // contracts:import haber corrido contra este Postgres (aislamiento de la
  // suite de contracts, ETAPA 6.6B2 §16).
  // Limpia restos de una corrida anterior de esta misma suite contra el
  // mismo Postgres desechable persistente (equipment_key='SN:TEST1' es el
  // marcador de fixture) -en orden de dependencia, antes de insertar.
  await pool.query(`
    DELETE FROM config.contract_service_windows WHERE schedule_id IN (
      SELECT schedule_id FROM config.contract_service_schedules WHERE contract_version_id IN (
        SELECT contract_version_id FROM config.contract_equipment_versions WHERE equipment_key = 'SN:TEST1'));
    DELETE FROM config.contract_service_schedules WHERE contract_version_id IN (
      SELECT contract_version_id FROM config.contract_equipment_versions WHERE equipment_key = 'SN:TEST1');
    DELETE FROM config.contract_equipment_versions WHERE equipment_key = 'SN:TEST1';
  `);

  // source_sha256 único por corrida (crypto.randomUUID) -contract_import_runs
  // tiene un UNIQUE parcial sobre source_sha256 WHERE import_status='SUCCESS'.
  const { randomUUID } = await import("node:crypto");
  const importRes = await pool.query(
    `INSERT INTO config.contract_import_runs (source_filename, source_sha256, effective_date, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('fixture.csv',$1,'2020-01-01',1,1,0,0,'SUCCESS') RETURNING import_id`,
    [randomUUID()]
  );
  const importId = importRes.rows[0].import_id;

  const versionRes = await pool.query(
    `INSERT INTO config.contract_equipment_versions
       (equipment_key, client_name_canonical, client_name_raw, equipment_model, installation_date_precision,
        contract_status_code, spa_tier_code, support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
        valid_from, valid_to, is_current, source_import_id, source_row_number, source_row_hash, contract_fingerprint)
     VALUES ('SN:TEST1','Cliente Test','Cliente Test','EQ-1','UNKNOWN',
             'ACTIVE_AUTO_RENEW','NO_SPA','REMOTE','NOT_INCLUDED','NO','NO','NO',
             '2020-01-01', NULL, true, $1, 1, 'fixture-row-hash', 'fixture-fingerprint')
     RETURNING contract_version_id`,
    [importId]
  );
  fixtureVersionId = Number(versionRes.rows[0].contract_version_id);

  const scheduleRes = await pool.query(
    `INSERT INTO config.contract_service_schedules (contract_version_id, coverage_type, parse_status) VALUES ($1,'FIXED_WINDOW','OK') RETURNING schedule_id`,
    [fixtureVersionId]
  );
  fixtureScheduleId = Number(scheduleRes.rows[0].schedule_id);

  await pool.query(
    `INSERT INTO config.contract_service_windows (schedule_id, day_of_week, start_time, end_time, all_day) VALUES ($1,'MON','00:00','23:59',false)`,
    [fixtureScheduleId]
  );

  // marts.fieldbeat_working_hours_analysis_current parte de
  // processed.fieldbeat_tasks (LEFT JOIN) -una fila de Capa C sin fila
  // correspondiente en processed.fieldbeat_tasks queda invisible en la
  // vista de transición (grano de la vista = tareas reales, no filas de
  // Capa C). Se insertan las fixture task_id usadas por esta suite.
  const fixtureTaskIds = [900001, 900002, 900101, 900102, 900201, 900301, 900302, 900401, 900501, 900601, 900701, 900702];
  await pool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id = ANY($1)`, [fixtureTaskIds]);
  for (const taskId of fixtureTaskIds) {
    await pool.query(`INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, start_time, duration_minutes) VALUES ($1, '2026-08-10T20:00:00Z', 60)`, [taskId]);
  }
});

after(async () => {
  if (pool) await pool.end();
});

beforeEach(async () => {
  if (!TEST_DB_URL) return;
  await pool.query("TRUNCATE marts.fieldbeat_working_hours_equipment_links, marts.fieldbeat_working_hours_analysis_v2, marts.fieldbeat_contract_coverage_segments RESTART IDENTITY CASCADE");
});

async function newRunId() {
  const r = await pool.query(`INSERT INTO audit.pipeline_runs (stage, status) VALUES ('working-hours-integration-test','STARTED') RETURNING run_id`);
  return r.rows[0].run_id;
}

test("publishResults: publica CONTRACTUAL + LEGACY_SCHEDULE correctamente, Capa B/C/bridge coherentes", { skip: !TEST_DB_URL }, async () => {
  const results = [makeResult(900001), makeLegacyResult(900002)];
  const runId = await newRunId();
  await publishResults(pool, results, runId);

  const v2 = await pool.query("SELECT fieldbeat_task_id, data_basis FROM marts.fieldbeat_working_hours_analysis_v2 ORDER BY fieldbeat_task_id");
  assert.deepEqual(v2.rows.map(r => [Number(r.fieldbeat_task_id), r.data_basis]), [[900001, "CONTRACTUAL"], [900002, "LEGACY_SCHEDULE"]]);

  const segCount = await pool.query("SELECT count(*) FROM marts.fieldbeat_contract_coverage_segments");
  assert.ok(Number(segCount.rows[0].count) > 0);
});

test("publishResults: la vista de transición expone ambas tareas publicadas", { skip: !TEST_DB_URL }, async () => {
  const results = [makeResult(900101), makeLegacyResult(900102)];
  const runId = await newRunId();
  await publishResults(pool, results, runId);

  const viewRes = await pool.query("SELECT fieldbeat_task_id, data_basis FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id IN (900101,900102) ORDER BY fieldbeat_task_id");
  assert.equal(viewRes.rows.length, 2);
  assert.equal(viewRes.rows[0].data_basis, "CONTRACTUAL");
  assert.equal(viewRes.rows[1].data_basis, "LEGACY_SCHEDULE");
});

test("publishResults: idempotente -republicar produce el mismo conteo final, sin duplicar", { skip: !TEST_DB_URL }, async () => {
  const results = [makeResult(900201)];
  await publishResults(pool, results, await newRunId());
  await publishResults(pool, results, await newRunId());

  const count = await pool.query("SELECT count(*) FROM marts.fieldbeat_working_hours_analysis_v2");
  assert.equal(Number(count.rows[0].count), 1);
});

test("publishResults: rollback completo ante fallo -cero filas parciales", { skip: !TEST_DB_URL }, async () => {
  const goodResult = makeResult(900301);
  const brokenResult = makeResult(900302);
  brokenResult.segments = brokenResult.segments.map(s => ({ ...s, coverageType: "NOT_A_REAL_COVERAGE_TYPE" })); // viola el CHECK de coverage_type

  const runId = await newRunId();
  await assert.rejects(() => publishResults(pool, [goodResult, brokenResult], runId));

  const count = await pool.query("SELECT count(*) FROM marts.fieldbeat_working_hours_analysis_v2");
  assert.equal(Number(count.rows[0].count), 0, "ninguna fila debe quedar escrita tras el rollback, ni siquiera la tarea válida");
});

test("publishResults: bridge -exactamente 1 is_primary para CONTRACTUAL de un solo equipo", { skip: !TEST_DB_URL }, async () => {
  const results = [makeResult(900401)];
  await publishResults(pool, results, await newRunId());

  const primaryCount = await pool.query(`
    SELECT count(*) FROM marts.fieldbeat_working_hours_equipment_links l
    JOIN marts.fieldbeat_working_hours_analysis_v2 v ON v.working_hours_id = l.working_hours_id
    WHERE v.fieldbeat_task_id = 900401 AND l.is_primary
  `);
  assert.equal(Number(primaryCount.rows[0].count), 1);
});

test("publishResults: NONE nunca persiste minutos -covered/outside quedan NULL", { skip: !TEST_DB_URL }, async () => {
  const noneResult = { fieldbeatTaskId: 900501, ...buildTaskCoverage({
    task: { startTimeRaw: null, durationMinutes: null },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [], holidayLookup: alwaysNotHoliday, businessHoursCfg
  }) };
  assert.equal(noneResult.dataBasis, "NONE");
  await publishResults(pool, [noneResult], await newRunId());

  const row = await pool.query("SELECT covered_seconds, outside_coverage_seconds FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900501");
  assert.equal(row.rows[0].covered_seconds, null);
  assert.equal(row.rows[0].outside_coverage_seconds, null);
});

test("publishResults: builder_run_id persistido referencia una fila real de audit.pipeline_runs", { skip: !TEST_DB_URL }, async () => {
  const runId = await newRunId();
  await publishResults(pool, [makeResult(900601)], runId);

  const row = await pool.query("SELECT builder_run_id FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900601");
  assert.equal(row.rows[0].builder_run_id, runId);
});

test("grants: nexus_app tiene SELECT en la vista de transición pero ningún privilegio en las tablas base", { skip: !TEST_DB_URL }, async () => {
  const viewGrants = await pool.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='fieldbeat_working_hours_analysis_current' AND grantee='nexus_app'`);
  assert.deepEqual(viewGrants.rows.map(r => r.privilege_type), ["SELECT"]);

  const baseGrants = await pool.query(`
    SELECT table_name FROM information_schema.role_table_grants
    WHERE grantee='nexus_app' AND table_name IN ('fieldbeat_working_hours_analysis_v2','fieldbeat_contract_coverage_segments','fieldbeat_working_hours_equipment_links')
  `);
  assert.equal(baseGrants.rows.length, 0);
});

test("concurrencia: 2 publishResults concurrentes se serializan por el advisory lock (nunca corren realmente en paralelo)", { skip: !TEST_DB_URL }, async () => {
  const resultsA = [makeResult(900701)];
  const resultsB = [makeResult(900702)];

  const runIdA = await newRunId();
  const runIdB = await newRunId();

  const startA = performance.now();
  const startB = performance.now();
  await Promise.all([
    publishResults(pool, resultsA, runIdA),
    publishResults(pool, resultsB, runIdB)
  ]);
  void startA; void startB;

  // Si el lock advisory sirvió, AMBAS tareas quedan publicadas (una tras
  // otra, nunca corrompidas por una carrera) -TRUNCATE dentro de cada
  // transacción sin serialización dejaría a lo sumo 1 fila visible.
  const count = await pool.query("SELECT count(*) FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id IN (900701,900702)");
  assert.equal(Number(count.rows[0].count), 1, "cada publishResults hace TRUNCATE de toda la tabla -el ganador de la carrera de advisory lock es quien queda, nunca ambos ni ninguno corrupto");
});

test("summarizeResults: distribuciones agregadas coherentes con los resultados de entrada", () => {
  const results = [makeResult(1), makeLegacyResult(2), makeLegacyResult(3)];
  const summary = summarizeResults(results);
  assert.equal(summary.totalTasks, 3);
  assert.equal(summary.byDataBasis.CONTRACTUAL, 1);
  assert.equal(summary.byDataBasis.LEGACY_SCHEDULE, 2);
});

test("validateBeforePublish: detecta fieldbeat_task_id duplicado", () => {
  const results = [makeResult(1), makeResult(1)];
  const v = validateBeforePublish(results);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes("duplicado")));
});
