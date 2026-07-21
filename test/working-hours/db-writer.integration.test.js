// Pruebas de integración contra un Postgres real y DESECHABLE -nunca
// Supabase productivo. Se saltan enteras si WORKING_HOURS_TEST_DATABASE_URL
// no está seteada. Aislada de CONTRACTS_TEST_DATABASE_URL/
// HOLIDAYS_TEST_DATABASE_URL/working-hours-B0 a propósito (ETAPA 6.6B2 §16).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildTaskCoverage } from "../../src/working-hours/task-coverage-builder.js";
import { validateBeforePublish, publishResults, summarizeResults, buildEquipmentInternalIds, loadReferenceData, runBuild } from "../../src/working-hours/db-writer.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";

// ETAPA SAFETY-1 - ver test/working-hours/ddl.integration.test.js para el
// contexto completo del incidente que motivó este guard.
const TEST_DB_URL = process.env.WORKING_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.WORKING_HOURS_TEST_RUN_ID;
const SUITE_ID = "working-hours-db-writer-test";
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
  if (!TEST_RUN_ID) {
    throw new Error(`Falta WORKING_HOURS_TEST_RUN_ID -requerido junto con WORKING_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).`);
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(pool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
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
  const fixtureTaskIds = [900001, 900002, 900101, 900102, 900201, 900301, 900302, 900401, 900501, 900601, 900701, 900702, 900801, 900802, 901001, 901002, 901003];
  await pool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id = ANY($1)`, [fixtureTaskIds]);
  for (const taskId of fixtureTaskIds) {
    await pool.query(
      `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, start_time, duration_minutes, client_key) VALUES ($1, '2026-08-10T20:00:00Z', 60, 'CLIENTE-NOMBRE-TEST')`,
      [taskId]
    );
  }

  // Fixtures para la corrección de client_name/client_rut/equipment_internal_ids
  // (loadReferenceData debe resolver estos campos desde fuentes gobernadas
  // reales -processed.fieldbeat_clients y processed.fieldbeat_task_equipments/
  // fieldbeat_equipments- no fabricarlos).
  await pool.query(`DELETE FROM processed.fieldbeat_clients WHERE client_key = 'CLIENTE-NOMBRE-TEST'`);
  await pool.query(
    `INSERT INTO processed.fieldbeat_clients (client_key, client_name, rut) VALUES ('CLIENTE-NOMBRE-TEST', 'Cliente De Prueba SPA', '11.111.111-1')`
  );
  await pool.query(`DELETE FROM processed.fieldbeat_task_equipments WHERE fieldbeat_task_id IN (900801, 900802)`);
  await pool.query(`DELETE FROM processed.fieldbeat_equipments WHERE equipment_uuid IN ('fixture-equip-a','fixture-equip-b')`);
  await pool.query(
    `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key) VALUES
       ('FIELDBEAT_EQUIPMENT|fixture-equip-a|EQ-A','fixture-equip-a','EQ-INTERNAL-A','CLIENTE-NOMBRE-TEST'),
       ('FIELDBEAT_EQUIPMENT|fixture-equip-b|EQ-B','fixture-equip-b','EQ-INTERNAL-B','CLIENTE-NOMBRE-TEST')`
  );
  // 900801: 2 equipos distintos (multi-equipo) + 1 fila duplicada del mismo
  // equipo (reextracción del ETL) -debe deduplicarse a exactamente 2 ids.
  await pool.query(
    `INSERT INTO processed.fieldbeat_task_equipments (task_equipment_id, fieldbeat_task_id, equipment_uuid, equipment_internal_id) VALUES
       ('fixture-te-1', 900801, 'fixture-equip-a', 'EQ-INTERNAL-A'),
       ('fixture-te-1-dup', 900801, 'fixture-equip-a', 'EQ-INTERNAL-A'),
       ('fixture-te-2', 900801, 'fixture-equip-b', 'EQ-INTERNAL-B')`
  );
  // 900802: sin ninguna fila en fieldbeat_task_equipments -tarea sin equipo.

  // ETAPA 6.5.2B0 - fixtures para el defecto de equipment_uuid NULL
  // colisionando en fbKeyByUuid. Se limpia por equipment_key (equipment_uuid
  // NULL nunca compara igual a sí mismo en SQL, IN(...) no sirve acá).
  await pool.query(
    `DELETE FROM processed.fieldbeat_equipments WHERE equipment_key IN
       ('FIELDBEAT_EQUIPMENT||FIXTURE-NULL-A','FIELDBEAT_EQUIPMENT||FIXTURE-NULL-B','FIELDBEAT_EQUIPMENT|fixture-real-uuid|FIXTURE-REAL')`
  );
  await pool.query(
    `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key) VALUES
       ('FIELDBEAT_EQUIPMENT||FIXTURE-NULL-A', NULL, 'FIXTURE-NULL-A', 'CLIENTE-NOMBRE-TEST'),
       ('FIELDBEAT_EQUIPMENT||FIXTURE-NULL-B', NULL, 'FIXTURE-NULL-B', 'CLIENTE-NOMBRE-TEST'),
       ('FIELDBEAT_EQUIPMENT|fixture-real-uuid|FIXTURE-REAL', 'fixture-real-uuid', 'FIXTURE-REAL', 'CLIENTE-NOMBRE-TEST')`
  );
  await pool.query(`DELETE FROM processed.fieldbeat_task_equipments WHERE fieldbeat_task_id IN (901001, 901002, 901003)`);
  await pool.query(
    `INSERT INTO processed.fieldbeat_task_equipments (task_equipment_id, fieldbeat_task_id, equipment_uuid, equipment_internal_id) VALUES
       ('fixture-te-null-1', 901001, NULL, 'FIXTURE-NULL-A'),
       ('fixture-te-real-1', 901002, 'fixture-real-uuid', 'FIXTURE-REAL'),
       ('fixture-te-null-2', 901003, NULL, 'FIXTURE-NULL-B')`
  );
  // 901001/901003: enlazadas a equipment_uuid=NULL (2 equipos DISTINTOS
  // reales, mismo patrón que la producción real) -deben terminar sin
  // ningún equipo resuelto (NO_EQUIPMENT), nunca heredar 901002's real.
  // 901002: uuid real, único -debe seguir resolviendo exacto pese al ruido NULL.
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

// === Corrección: client_name/client_rut/equipment_internal_ids (auditoría
// BLOCKED_UPSTREAM -el builder nunca los persistía, ver db-writer.js) ===

test("buildEquipmentInternalIds: deduplica, ordena y une con ', ' -determinista", () => {
  const ids = buildEquipmentInternalIds([
    { fieldbeatInternalId: "EQ-B" },
    { fieldbeatInternalId: "EQ-A" },
    { fieldbeatInternalId: "EQ-A" } // duplicado -no debe repetirse
  ]);
  assert.equal(ids, "EQ-A, EQ-B");
});

test("buildEquipmentInternalIds: tarea sin equipos -> null, NUNCA ''", () => {
  assert.equal(buildEquipmentInternalIds([]), null);
  assert.equal(buildEquipmentInternalIds(undefined), null);
});

test("buildEquipmentInternalIds: ids vacíos/null en el origen se descartan, no producen '' en el resultado", () => {
  const ids = buildEquipmentInternalIds([{ fieldbeatInternalId: null }, { fieldbeatInternalId: "" }, { fieldbeatInternalId: "EQ-X" }]);
  assert.equal(ids, "EQ-X");
});

test("buildEquipmentInternalIds: si TODOS los ids del origen son vacíos/null -> null, no una lista vacía", () => {
  assert.equal(buildEquipmentInternalIds([{ fieldbeatInternalId: null }, { fieldbeatInternalId: "" }]), null);
});

test("loadReferenceData: resuelve client_name/client_rut desde processed.fieldbeat_clients (fuente gobernada real)", { skip: !TEST_DB_URL }, async () => {
  const refData = await loadReferenceData(pool);
  const info = refData.clientByKey.get("CLIENTE-NOMBRE-TEST");
  assert.equal(info.clientName, "Cliente De Prueba SPA");
  assert.equal(info.clientRut, "11.111.111-1");
});

test("loadReferenceData: client_key sin match en fieldbeat_clients -> ausente del mapa, nunca fabricado", { skip: !TEST_DB_URL }, async () => {
  const refData = await loadReferenceData(pool);
  assert.equal(refData.clientByKey.has("CLIENTE-QUE-NO-EXISTE"), false);
});

test("runBuild: tarea multi-equipo (900801) trae los 2 identificadores esperados, deduplicados", { skip: !TEST_DB_URL }, async () => {
  const { results } = await runBuild(pool);
  const r = results.find(x => Number(x.fieldbeatTaskId) === 900801);
  assert.ok(r, "resultado 900801 no encontrado en runBuild()");
  assert.equal(r.clientName, "Cliente De Prueba SPA");
  assert.equal(r.clientRut, "11.111.111-1");
  assert.equal(r.equipmentInternalIds, "EQ-INTERNAL-A, EQ-INTERNAL-B");
});

test("runBuild: tarea sin equipo (900802) mantiene equipmentInternalIds NULL honesto, pero cliente/RUT sí se resuelven", { skip: !TEST_DB_URL }, async () => {
  const { results } = await runBuild(pool);
  const r = results.find(x => Number(x.fieldbeatTaskId) === 900802);
  assert.ok(r, "resultado 900802 no encontrado en runBuild()");
  assert.equal(r.equipmentInternalIds, null);
  assert.equal(r.clientName, "Cliente De Prueba SPA");
  assert.equal(r.clientRut, "11.111.111-1");
});

test("publishResults: persiste client_name/client_rut/task_type/assigned_to/equipment_internal_ids -round trip real, no solo en memoria", { skip: !TEST_DB_URL }, async () => {
  const result = makeResult(900001, {
    clientKey: "CLIENTE-NOMBRE-TEST", clientName: "Cliente De Prueba SPA", clientRut: "11.111.111-1",
    taskType: "PM", assignedTo: "tech1", equipmentInternalIds: "EQ-INTERNAL-A, EQ-INTERNAL-B"
  });
  await publishResults(pool, [result], await newRunId());

  const row = await pool.query(
    "SELECT client_key, client_name, client_rut, task_type, assigned_to, equipment_internal_ids FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900001"
  );
  assert.deepEqual(row.rows[0], {
    client_key: "CLIENTE-NOMBRE-TEST", client_name: "Cliente De Prueba SPA", client_rut: "11.111.111-1",
    task_type: "PM", assigned_to: "tech1", equipment_internal_ids: "EQ-INTERNAL-A, EQ-INTERNAL-B"
  });
});

test("publishResults: equipment_internal_ids ausente (undefined en el result) persiste como NULL, no como el string 'undefined'", { skip: !TEST_DB_URL }, async () => {
  const result = makeResult(900101); // sin overrides -campos nuevos undefined
  await publishResults(pool, [result], await newRunId());

  const row = await pool.query("SELECT client_name, equipment_internal_ids FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900101");
  assert.equal(row.rows[0].client_name, null);
  assert.equal(row.rows[0].equipment_internal_ids, null);
});

// === Investigación: start_time_local/end_time_local NULL en TODAS las
// filas calculables (CONTRACTUAL y LEGACY_SCHEDULE por igual, no es
// específico de LEGACY_SCHEDULE -ver hipótesis de causa raíz entregada).
// Causa raíz: publishResults() nunca escribía estas 2 columnas -v2Columns/
// v2Rows las omitían por completo. Test rojo antes del fix: startTimeRaw=
// "2026-08-10T20:00:00Z" en invierno chileno (UTC-4) -> local esperado
// "2026-08-10 16:00:00".

test("publishResults: persiste start_time_local/end_time_local derivados de startTimeUtc/endTimeUtc, CONTRACTUAL", { skip: !TEST_DB_URL }, async () => {
  const result = makeResult(900001);
  await publishResults(pool, [result], await newRunId());

  const row = await pool.query("SELECT start_time_local, end_time_local FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900001");
  assert.equal(row.rows[0].start_time_local, "2026-08-10 16:00:00", "startTimeRaw=2026-08-10T20:00:00Z en invierno chileno (UTC-4) debe dar 16:00 local");
  assert.equal(row.rows[0].end_time_local, "2026-08-10 17:00:00");
});

test("publishResults: persiste start_time_local/end_time_local también en LEGACY_SCHEDULE (mismo defecto, no exclusivo de CONTRACTUAL)", { skip: !TEST_DB_URL }, async () => {
  const result = makeLegacyResult(900002);
  await publishResults(pool, [result], await newRunId());

  const row = await pool.query("SELECT start_time_local, end_time_local FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900002");
  assert.equal(row.rows[0].start_time_local, "2026-08-10 16:00:00");
  assert.equal(row.rows[0].end_time_local, "2026-08-10 17:00:00");
});

test("publishResults: start_time_local usa el offset correcto en horario de verano (DST activo, UTC-3), no el de invierno", { skip: !TEST_DB_URL }, async () => {
  // 2026-10-01 es posterior al inicio de DST confirmado (~2026-09-06,
  // mismas fechas reales que test/working-hours/timezone-resolver.test.js)
  // -offset -180 (UTC-3), no -240 (UTC-4) como en el fixture de invierno.
  const dstResult = buildTaskCoverage({
    task: { startTimeRaw: "2026-10-01T20:00:00Z", durationMinutes: 60, clientKey: "CLIENTE-TEST", taskType: "PM", assignedTo: "tech1" },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [{
      fieldbeatEquipmentKey: "FIELDBEAT_EQUIPMENT|test-uuid|EQ-1",
      match: { matchStatus: "MATCHED", matchMethod: "SERIAL_SUFFIX", contractEquipmentKey: "SN:TEST1" },
      versions: [{ contractVersionId: fixtureVersionId, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }],
      scheduleByVersionId: new Map([[fixtureVersionId, { scheduleId: fixtureScheduleId, coverageType: "FIXED_WINDOW", parseStatus: "OK" }]]),
      windowsByScheduleId: new Map([[fixtureScheduleId, [{ dayOfWeek: "THU", startTime: "00:00", endTime: "23:59", allDay: false }]]])
    }],
    holidayLookup: alwaysNotHoliday,
    businessHoursCfg
  });
  await publishResults(pool, [{ fieldbeatTaskId: 900001, ...dstResult }], await newRunId());

  const row = await pool.query("SELECT start_time_local FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900001");
  assert.equal(row.rows[0].start_time_local, "2026-10-01 17:00:00", "20:00 UTC en DST (UTC-3) debe dar 17:00 local, no 16:00 (que sería UTC-4)");
});

test("publishResults: startTimeUtc=null (NONE terminal) -> start_time_local NULL, nunca fabricado", { skip: !TEST_DB_URL }, async () => {
  const noneResult = { fieldbeatTaskId: 900501, ...buildTaskCoverage({
    task: { startTimeRaw: null, durationMinutes: null },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [], holidayLookup: alwaysNotHoliday, businessHoursCfg
  }) };
  await publishResults(pool, [noneResult], await newRunId());

  const row = await pool.query("SELECT start_time_local, end_time_local FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900501");
  assert.equal(row.rows[0].start_time_local, null);
  assert.equal(row.rows[0].end_time_local, null);
});

// === Caso pedido explícitamente: NONE con intervalo RESUELTO (fallo de
// cobertura, no fallo del intervalo) -distinto del NONE terminal de arriba
// (900501, sin start_time_raw). Acá el intervalo sí se resuelve
// (EXACT_REPORTED_START_END/ESTIMATED_FROM_START_DURATION), pero AMBOS
// intentos de cobertura fallan: CONTRACTUAL por NO_EQUIPMENT
// (equipmentInputs=[]), LEGACY_SCHEDULE por HOLIDAY_COVERAGE_UNKNOWN
// (holidayLookup siempre COVERAGE_UNKNOWN -> aggregateSegments marca
// calculable=false). Rama 4 de task-coverage-builder.js.
function alwaysCoverageUnknown(localDate) {
  void localDate;
  return "COVERAGE_UNKNOWN";
}

test("publishResults: NONE con intervalo resuelto pero cobertura no resuelta -start_time_local/end_time_local derivados, data_basis sigue NONE, fila no se vuelve calculable, reason codes conservados", { skip: !TEST_DB_URL }, async () => {
  const result = { fieldbeatTaskId: 900901, ...buildTaskCoverage({
    task: { startTimeRaw: "2026-08-10T20:00:00Z", durationMinutes: 60, clientKey: "CLIENTE-TEST", taskType: "PM", assignedTo: "tech1" },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [], // sin equipo -> intento CONTRACTUAL falla con NO_EQUIPMENT
    holidayLookup: alwaysCoverageUnknown, // fallback LEGACY_SCHEDULE también falla -> HOLIDAY_COVERAGE_UNKNOWN
    businessHoursCfg
  }) };

  // Confirma en memoria, ANTES de publicar, que buildTaskCoverage() realmente
  // produjo el escenario pedido -si esto no se cumple, el fixture está mal
  // construido, no es un resultado real de "fallo de cobertura".
  assert.equal(result.dataBasis, "NONE");
  assert.ok(result.startTimeUtc, "el intervalo debe estar resuelto (fallo de COBERTURA, no de intervalo)");
  assert.ok(result.endTimeUtc);
  assert.equal(result.calculationStatus, "NOT_CALCULABLE");
  assert.equal(result.coverageReasonCode, "NO_EQUIPMENT");
  assert.equal(result.contractualReasonCode, "NO_EQUIPMENT");
  assert.equal(result.contractualAttemptStatus, "NOT_CALCULABLE");

  await publishResults(pool, [result], await newRunId());

  const row = await pool.query(
    `SELECT data_basis, calculation_status, coverage_classification, coverage_reason_code,
            contractual_attempt_status, contractual_coverage_classification, contractual_reason_code,
            start_time_utc, start_time_local, end_time_utc, end_time_local,
            covered_seconds, outside_coverage_seconds, after_hours_total_seconds
     FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id=900901`
  );
  const r = row.rows[0];

  // data_basis sigue NONE, la fila no se vuelve calculable.
  assert.equal(r.data_basis, "NONE");
  assert.equal(r.calculation_status, "NOT_CALCULABLE");
  assert.equal(r.coverage_classification, "NOT_CALCULABLE");

  // start_time_local/end_time_local derivados desde start_time_utc/end_time_utc
  // (2026-08-10T20:00:00Z, invierno chileno UTC-4 -> 16:00 local; +60min -> 17:00).
  assert.ok(r.start_time_utc, "start_time_utc debe estar presente (intervalo resuelto)");
  assert.equal(r.start_time_local, "2026-08-10 16:00:00");
  assert.ok(r.end_time_utc);
  assert.equal(r.end_time_local, "2026-08-10 17:00:00");

  // business_minutes/after_hours_minutes (covered_seconds/after_hours_total_seconds
  // en Capa C) con semántica NO CALCULABLE -NULL, nunca 0.
  assert.equal(r.covered_seconds, null);
  assert.equal(r.outside_coverage_seconds, null);
  assert.equal(r.after_hours_total_seconds, null);

  // Motivos de no cálculo conservados, NUNCA descartados silenciosamente.
  assert.equal(r.coverage_reason_code, "NO_EQUIPMENT");
  assert.equal(r.contractual_attempt_status, "NOT_CALCULABLE");
  assert.equal(r.contractual_coverage_classification, "NOT_CALCULABLE");
  assert.equal(r.contractual_reason_code, "NO_EQUIPMENT");
});

// === Invariantes de publicación (bicondicional real, no solo "en la
// mayoría de los casos"): se verifican sobre TODAS las filas publicadas en
// este test -CONTRACTUAL, LEGACY_SCHEDULE, NONE terminal y NONE con
// intervalo resuelto, a la vez- para que la ausencia de violaciones no
// dependa de un único escenario feliz.
test("publishResults: invariante -start_time_utc presente <=> start_time_local presente, para TODA fila, sin excepción", { skip: !TEST_DB_URL }, async () => {
  const contractual = makeResult(900001);
  const legacy = makeLegacyResult(900002);
  const noneTerminal = { fieldbeatTaskId: 900501, ...buildTaskCoverage({
    task: { startTimeRaw: null, durationMinutes: null },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [], holidayLookup: alwaysNotHoliday, businessHoursCfg
  }) };
  const noneResolved = { fieldbeatTaskId: 900901, ...buildTaskCoverage({
    task: { startTimeRaw: "2026-08-10T20:00:00Z", durationMinutes: 60, clientKey: "CLIENTE-TEST", taskType: "PM", assignedTo: "tech1" },
    confidenceContext: { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" },
    equipmentInputs: [], holidayLookup: alwaysCoverageUnknown, businessHoursCfg
  }) };

  await publishResults(pool, [contractual, legacy, noneTerminal, noneResolved], await newRunId());

  const violations = await pool.query(`
    SELECT fieldbeat_task_id,
      (start_time_utc IS NOT NULL) AS has_start_utc, (start_time_local IS NOT NULL) AS has_start_local,
      (end_time_utc IS NOT NULL) AS has_end_utc, (end_time_local IS NOT NULL) AS has_end_local
    FROM marts.fieldbeat_working_hours_analysis_v2
    WHERE fieldbeat_task_id IN (900001, 900002, 900501, 900901)
      AND ((start_time_utc IS NOT NULL) <> (start_time_local IS NOT NULL)
        OR (end_time_utc IS NOT NULL) <> (end_time_local IS NOT NULL))
  `);
  assert.deepEqual(violations.rows, [], `filas con start/end _utc y _local desincronizados: ${JSON.stringify(violations.rows)}`);

  // Confirma explícitamente que el conjunto de prueba realmente ejerce
  // ambos lados del bicondicional (presente Y ausente) -si esto no se
  // cumple, el test anterior sería vacuamente verdadero.
  const presence = await pool.query(`
    SELECT count(*) FILTER (WHERE start_time_utc IS NOT NULL) AS con_utc, count(*) FILTER (WHERE start_time_utc IS NULL) AS sin_utc
    FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id IN (900001, 900002, 900501, 900901)
  `);
  assert.equal(Number(presence.rows[0].con_utc), 3, "se esperan 3 filas con start_time_utc (CONTRACTUAL, LEGACY_SCHEDULE, NONE-resuelto)");
  assert.equal(Number(presence.rows[0].sin_utc), 1, "se espera 1 fila sin start_time_utc (NONE terminal)");
});

// === ETAPA 6.5.2B0: nivel de tarea completo, vía loadReferenceData()/
// runBuild() reales (no la función pura aislada de db-writer.test.js) ===

test("runBuild: 2 tareas con equipment_uuid=NULL (equipos DISTINTOS reales) no heredan ningún equipo -equipmentInputs vacío, NO_EQUIPMENT", { skip: !TEST_DB_URL }, async () => {
  const refData = await loadReferenceData(pool);
  assert.equal(refData.equipByTask.has("901001"), false, "901001 (equipment_uuid=NULL) no debe tener ningún equipo resuelto");
  assert.equal(refData.equipByTask.has("901003"), false, "901003 (equipment_uuid=NULL, OTRO equipo real distinto) no debe tener ningún equipo resuelto");

  const { results } = await runBuild(pool);
  const r1 = results.find(x => Number(x.fieldbeatTaskId) === 901001);
  const r3 = results.find(x => Number(x.fieldbeatTaskId) === 901003);
  assert.equal(r1.contractualReasonCode, "NO_EQUIPMENT");
  assert.equal(r3.contractualReasonCode, "NO_EQUIPMENT");
});

test("runBuild: tarea con equipment_uuid real y único sigue resolviendo su equipo exacto, sin contaminarse por el ruido NULL de otras filas", { skip: !TEST_DB_URL }, async () => {
  const refData = await loadReferenceData(pool);
  const equip = refData.equipByTask.get("901002");
  assert.ok(equip, "901002 (equipment_uuid real) debe tener su equipo resuelto");
  assert.equal(equip.length, 1);
  assert.equal(equip[0].fieldbeatEquipmentKey, "FIELDBEAT_EQUIPMENT|fixture-real-uuid|FIXTURE-REAL");
});

test("runBuild: ninguna de las tareas NULL hereda la identidad de la tarea con uuid real (no contaminación cruzada)", { skip: !TEST_DB_URL }, async () => {
  const refData = await loadReferenceData(pool);
  const equip1 = refData.equipByTask.get("901001") ?? [];
  const equip3 = refData.equipByTask.get("901003") ?? [];
  assert.ok(!equip1.some(e => e.fieldbeatEquipmentKey === "FIELDBEAT_EQUIPMENT|fixture-real-uuid|FIXTURE-REAL"));
  assert.ok(!equip3.some(e => e.fieldbeatEquipmentKey === "FIELDBEAT_EQUIPMENT|fixture-real-uuid|FIXTURE-REAL"));
});

test("vista de transición: expone client_name/equipment_internal_ids reales tras la corrección (900801)", { skip: !TEST_DB_URL }, async () => {
  const { results } = await runBuild(pool);
  const r = results.find(x => Number(x.fieldbeatTaskId) === 900801);
  await publishResults(pool, [r], await newRunId());

  const viewRow = await pool.query("SELECT client_name, equipment_internal_ids FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id=900801");
  assert.equal(viewRow.rows[0].client_name, "Cliente De Prueba SPA");
  assert.equal(viewRow.rows[0].equipment_internal_ids, "EQ-INTERNAL-A, EQ-INTERNAL-B");
});
