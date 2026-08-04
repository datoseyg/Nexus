// Pruebas de integración contra un Postgres real y DESECHABLE -nunca
// Supabase productivo. Se saltan enteras si WORKING_HOURS_TEST_DATABASE_URL
// no está seteada. Aislada de CONTRACTS_TEST_DATABASE_URL/
// HOLIDAYS_TEST_DATABASE_URL a propósito (ETAPA 6.6B2 §16: "mantén suites
// aisladas de contracts, holidays y working-hours B0") -antes de esta
// corrección compartía CONTRACTS_TEST_DATABASE_URL, violando ese requisito.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";

// ETAPA SAFETY-1 - WORKING_HOURS_TEST_RUN_ID debe venir del run_id impreso
// por scripts/bootstrap-disposable-postgres.mjs al sembrar la base. Sin
// esto, assertDisposableTarget() aborta ANTES del primer INSERT -ver
// reporte de ETAPA SAFETY-1 (incidente: esta suite corrió una vez contra
// nexus-afterhours-realdata2 porque el único guard era `if (!TEST_DB_URL)`).
const TEST_DB_URL = process.env.WORKING_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.WORKING_HOURS_TEST_RUN_ID;
const SUITE_ID = "working-hours-ddl-test";
const { Pool } = pg;

let adminPool;
let builderRunId;

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error(`Falta WORKING_HOURS_TEST_RUN_ID -requerido junto con WORKING_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).`);
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });
  const r = await adminPool.query(
    `INSERT INTO audit.pipeline_runs (stage, status) VALUES ('working-hours-test', 'SUCCESS') RETURNING run_id`
  );
  builderRunId = r.rows[0].run_id;
});

after(async () => {
  if (adminPool) await adminPool.end();
});

// --- Helpers para filas base válidas, mutadas por cada test ---

function validSegment(overrides = {}) {
  return {
    fieldbeat_task_id: 900001,
    fieldbeat_equipment_key: "FB-LINAC-001",
    schedule_source: "CONTRACT",
    segment_start_utc: "2026-08-10T20:00:00Z",
    segment_end_utc: "2026-08-10T21:00:00Z",
    segment_local_date: "2026-08-10",
    day_of_week: "MON",
    boundary_reasons: ["TASK_START", "WINDOW_CLOSE"],
    is_holiday: false,
    holiday_coverage_status: "CONFIRMED_NOT_HOLIDAY",
    segment_seconds: 3600,
    segment_calculation_status: "CALCULATED",
    segment_coverage_state: "COVERED",
    segment_reason_code: "WITHIN_MATCHED_CONTRACT",
    outside_coverage_bucket: null,
    covered_seconds: 3600,
    outside_coverage_seconds: 0,
    builder_run_id: builderRunId,
    ...overrides
  };
}

async function insertSegment(pool, overrides = {}) {
  const s = validSegment(overrides);
  return pool.query(
    `INSERT INTO marts.fieldbeat_contract_coverage_segments
      (fieldbeat_task_id, fieldbeat_equipment_key, schedule_source, segment_start_utc, segment_end_utc,
       segment_local_date, day_of_week, boundary_reasons, is_holiday, holiday_coverage_status,
       segment_seconds, segment_calculation_status, segment_coverage_state, segment_reason_code,
       outside_coverage_bucket, covered_seconds, outside_coverage_seconds, builder_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      s.fieldbeat_task_id, s.fieldbeat_equipment_key, s.schedule_source, s.segment_start_utc, s.segment_end_utc,
      s.segment_local_date, s.day_of_week, s.boundary_reasons, s.is_holiday, s.holiday_coverage_status,
      s.segment_seconds, s.segment_calculation_status, s.segment_coverage_state, s.segment_reason_code,
      s.outside_coverage_bucket, s.covered_seconds, s.outside_coverage_seconds, s.builder_run_id
    ]
  );
}

function validCapaCRow(overrides = {}) {
  return {
    fieldbeat_task_id: 910001,
    calculation_status: "CALCULATED",
    coverage_classification: "FULLY_COVERED",
    coverage_reason_code: "WITHIN_MATCHED_CONTRACT",
    contractual_attempt_status: "CALCULATED",
    contractual_coverage_classification: "FULLY_COVERED",
    contractual_reason_code: "WITHIN_MATCHED_CONTRACT",
    fallback_used: false,
    data_basis: "CONTRACTUAL",
    contract_resolution_confidence: 90,
    start_time_utc: "2026-08-10T20:00:00Z",
    end_time_utc: "2026-08-10T21:00:00Z",
    duration_seconds: 3600,
    covered_seconds: 3600,
    outside_coverage_seconds: 0,
    after_hours_weekday_seconds: 0,
    weekend_seconds: 0,
    holiday_seconds: 0,
    after_hours_total_seconds: 0,
    after_hours_rate: 0,
    is_after_hours_task: false,
    builder_run_id: builderRunId,
    ...overrides
  };
}

async function insertCapaC(pool, overrides = {}) {
  const r = validCapaCRow(overrides);
  return pool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
      (fieldbeat_task_id, calculation_status, coverage_classification, coverage_reason_code,
       contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
       data_basis, contract_resolution_confidence, start_time_utc, end_time_utc, duration_seconds,
       covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
       after_hours_total_seconds, after_hours_rate, is_after_hours_task, builder_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING working_hours_id`,
    [
      r.fieldbeat_task_id, r.calculation_status, r.coverage_classification, r.coverage_reason_code,
      r.contractual_attempt_status, r.contractual_coverage_classification, r.contractual_reason_code, r.fallback_used,
      r.data_basis, r.contract_resolution_confidence, r.start_time_utc, r.end_time_utc, r.duration_seconds,
      r.covered_seconds, r.outside_coverage_seconds, r.after_hours_weekday_seconds, r.weekend_seconds, r.holiday_seconds,
      r.after_hours_total_seconds, r.after_hours_rate, r.is_after_hours_task, r.builder_run_id
    ]
  );
}

// ============================================================
// 1. Idempotencia (confirmada también manualmente vía psql, ver reporte) --
// esta prueba solo confirma que las tablas/objetos clave existen tras la
// aplicación real de 080/081/082 hecha antes de correr los tests.
// ============================================================
test("las tablas/vistas de 6.6B0 existen tras aplicar 080/081/082", { skip: !TEST_DB_URL }, async () => {
  const r = await adminPool.query(`
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE (table_schema, table_name) IN (
      ('config','holiday_import_runs'), ('config','holiday_calendar_entries'), ('config','holiday_calendar_coverage'),
      ('marts','fieldbeat_contract_coverage_segments'), ('marts','fieldbeat_working_hours_analysis_v2'),
      ('marts','fieldbeat_working_hours_equipment_links')
    )
    UNION ALL
    SELECT table_schema, table_name FROM information_schema.views
    WHERE (table_schema, table_name) IN (
      ('config','current_holiday_calendar_entries'), ('config','current_holiday_calendar_coverage'),
      ('marts','fieldbeat_working_hours_analysis_current')
    )
  `);
  assert.equal(r.rows.length, 9);
});

// ============================================================
// 2. Calendario de feriados
// ============================================================
test("2 eventos coincidentes en fecha, distinto source_event_key, mismo import -> permitido", { skip: !TEST_DB_URL }, async () => {
  const imp = await adminPool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('cal.csv', 'sha-coincident-1', 2, 2, 0, 0, 'SUCCESS') RETURNING import_id`
  );
  const importId = imp.rows[0].import_id;
  await adminPool.query(
    `INSERT INTO config.holiday_calendar_entries (local_date, jurisdiction, source_event_key, holiday_name, holiday_type, source_import_id)
     VALUES ('2026-09-18', 'CL', 'fiestas-patrias', 'Fiestas Patrias', 'FIXED_DATE', $1),
            ('2026-09-18', 'CL', 'feriado-regional-x', 'Feriado Regional X', 'REGIONAL', $1)`,
    [importId]
  );
  const rows = await adminPool.query(`SELECT COUNT(*)::int AS n FROM config.holiday_calendar_entries WHERE local_date = '2026-09-18' AND source_import_id = $1`, [importId]);
  assert.equal(rows.rows[0].n, 2);
});

test("2 eventos con el mismo source_event_key en el mismo import -> rechazado", { skip: !TEST_DB_URL }, async () => {
  const imp = await adminPool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('cal.csv', 'sha-dup-event-1', 1, 1, 0, 0, 'SUCCESS') RETURNING import_id`
  );
  const importId = imp.rows[0].import_id;
  await adminPool.query(
    `INSERT INTO config.holiday_calendar_entries (local_date, jurisdiction, source_event_key, holiday_name, holiday_type, source_import_id)
     VALUES ('2026-01-01', 'CL', 'ano-nuevo', 'Año Nuevo', 'FIXED_DATE', $1)`,
    [importId]
  );
  await assert.rejects(() =>
    adminPool.query(
      `INSERT INTO config.holiday_calendar_entries (local_date, jurisdiction, source_event_key, holiday_name, holiday_type, source_import_id)
       VALUES ('2026-01-01', 'CL', 'ano-nuevo', 'Año Nuevo (dup)', 'FIXED_DATE', $1)`,
      [importId]
    )
  );
});

test("reemplazo de cobertura vía publish_holiday_coverage: la anterior queda SUPERSEDED con puntero hacia adelante", { skip: !TEST_DB_URL }, async () => {
  const imp1 = await adminPool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('cal.csv', 'sha-cov-a', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`
  );
  const importA = imp1.rows[0].import_id;
  const pub1 = await adminPool.query(
    `SELECT config.publish_holiday_coverage('CL_TEST_A', daterange('2026-01-01','2027-01-01'), $1, NULL) AS id`,
    [importA]
  );
  const coverageAId = pub1.rows[0].id;

  const check1 = await adminPool.query(`SELECT coverage_status, superseded_by_coverage_id FROM config.holiday_calendar_coverage WHERE coverage_id = $1`, [coverageAId]);
  assert.equal(check1.rows[0].coverage_status, "VALIDATED");
  assert.equal(check1.rows[0].superseded_by_coverage_id, null);

  const imp2 = await adminPool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('cal2.csv', 'sha-cov-b', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`
  );
  const importB = imp2.rows[0].import_id;
  const pub2 = await adminPool.query(
    `SELECT config.publish_holiday_coverage('CL_TEST_A', daterange('2026-01-01','2027-01-01'), $1, $2) AS id`,
    [importB, coverageAId]
  );
  const coverageBId = pub2.rows[0].id;

  const checkA = await adminPool.query(`SELECT coverage_status, superseded_by_coverage_id FROM config.holiday_calendar_coverage WHERE coverage_id = $1`, [coverageAId]);
  assert.equal(checkA.rows[0].coverage_status, "SUPERSEDED");
  assert.equal(checkA.rows[0].superseded_by_coverage_id, coverageBId);

  const checkB = await adminPool.query(`SELECT coverage_status, superseded_by_coverage_id FROM config.holiday_calendar_coverage WHERE coverage_id = $1`, [coverageBId]);
  assert.equal(checkB.rows[0].coverage_status, "VALIDATED");
  assert.equal(checkB.rows[0].superseded_by_coverage_id, null);
});

test("trigger: 2 coberturas VALIDATED solapadas para la misma jurisdicción -> rechazado", { skip: !TEST_DB_URL }, async () => {
  const imp = await adminPool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('cal.csv', 'sha-overlap-1', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`
  );
  const importId = imp.rows[0].import_id;
  await adminPool.query(
    `SELECT config.publish_holiday_coverage('CL_TEST_OVERLAP', daterange('2026-01-01','2026-12-31'), $1, NULL)`,
    [importId]
  );
  await assert.rejects(() =>
    adminPool.query(
      `SELECT config.publish_holiday_coverage('CL_TEST_OVERLAP', daterange('2026-06-01','2027-01-01'), $1, NULL)`,
      [importId]
    ),
    /solapamiento/
  );
});

test("config.current_holiday_calendar_entries: solo expone entries de coberturas VALIDATED que las cubren", { skip: !TEST_DB_URL }, async () => {
  const imp = await adminPool.query(
    `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('cal.csv', 'sha-canonical-1', 1, 1, 0, 0, 'SUCCESS') RETURNING import_id`
  );
  const importId = imp.rows[0].import_id;
  await adminPool.query(
    `INSERT INTO config.holiday_calendar_entries (local_date, jurisdiction, source_event_key, holiday_name, holiday_type, source_import_id)
     VALUES ('2026-05-21', 'CL_TEST_CANON', 'glorias-navales', 'Glorias Navales', 'FIXED_DATE', $1)`,
    [importId]
  );
  // Sin cobertura todavía -no debe aparecer en la vista canónica.
  const before1 = await adminPool.query(`SELECT * FROM config.current_holiday_calendar_entries WHERE jurisdiction = 'CL_TEST_CANON'`);
  assert.equal(before1.rows.length, 0);

  await adminPool.query(`SELECT config.publish_holiday_coverage('CL_TEST_CANON', daterange('2026-01-01','2027-01-01'), $1, NULL)`, [importId]);

  const after1 = await adminPool.query(`SELECT * FROM config.current_holiday_calendar_entries WHERE jurisdiction = 'CL_TEST_CANON'`);
  assert.equal(after1.rows.length, 1);
  assert.equal(after1.rows[0].holiday_name, "Glorias Navales");
});

// ============================================================
// 3. Capa B -- segmentos
// ============================================================
test("segmento COVERED con covered_seconds != segment_seconds -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertSegment(adminPool, { covered_seconds: 100 }));
});

test("segmento OUTSIDE_COVERAGE con covered_seconds != 0 -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertSegment(adminPool, {
      segment_coverage_state: "OUTSIDE_COVERAGE",
      segment_reason_code: "WITHIN_MATCHED_CONTRACT",
      outside_coverage_bucket: "AFTER_HOURS_WEEKDAY",
      covered_seconds: 100,
      outside_coverage_seconds: 3500
    })
  );
});

test("segment_end_utc <= segment_start_utc -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertSegment(adminPool, { segment_end_utc: "2026-08-10T19:00:00Z" }));
});

test("segment_seconds no coincide con segment_end_utc - segment_start_utc -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertSegment(adminPool, { segment_seconds: 999 }));
});

test("timestamp con sub-segundo -> rechazado (normalización whole-seconds)", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertSegment(adminPool, { segment_start_utc: "2026-08-10T20:00:00.500Z" }));
});

test("dedup: 2 segmentos LEGACY_GLOBAL idénticos (equipment_key NULL) -> rechazado", { skip: !TEST_DB_URL }, async () => {
  const base = {
    fieldbeat_equipment_key: null,
    schedule_source: "LEGACY_GLOBAL",
    segment_reason_code: "WITHIN_LEGACY_SCHEDULE",
    match_status: null
  };
  await insertSegment(adminPool, { ...base, fieldbeat_task_id: 900002 });
  await assert.rejects(() => insertSegment(adminPool, { ...base, fieldbeat_task_id: 900002 }));
});

test("matriz reason_code: LEGACY_GLOBAL con EQUIPMENT_UNMATCHED -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertSegment(adminPool, {
      fieldbeat_task_id: 900003,
      fieldbeat_equipment_key: null,
      schedule_source: "LEGACY_GLOBAL",
      segment_reason_code: "EQUIPMENT_UNMATCHED",
      segment_calculation_status: "NOT_CALCULABLE",
      segment_coverage_state: "NOT_CALCULABLE",
      covered_seconds: null,
      outside_coverage_seconds: null
    })
  );
});

test("matriz reason_code: CONTRACT con WITHIN_LEGACY_SCHEDULE -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertSegment(adminPool, { fieldbeat_task_id: 900004, segment_reason_code: "WITHIN_LEGACY_SCHEDULE" }));
});

test("outside_coverage_bucket=HOLIDAY con holiday_coverage_status=CONFIRMED_NOT_HOLIDAY -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertSegment(adminPool, {
      fieldbeat_task_id: 900005,
      segment_coverage_state: "OUTSIDE_COVERAGE",
      outside_coverage_bucket: "HOLIDAY",
      covered_seconds: 0,
      outside_coverage_seconds: 3600,
      holiday_coverage_status: "CONFIRMED_NOT_HOLIDAY",
      is_holiday: false
    })
  );
});

test("is_holiday=false bajo holiday_coverage_status=COVERAGE_UNKNOWN -> rechazado (debe ser NULL)", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertSegment(adminPool, {
      fieldbeat_task_id: 900006,
      holiday_coverage_status: "COVERAGE_UNKNOWN",
      segment_calculation_status: "NOT_CALCULABLE",
      segment_coverage_state: "NOT_CALCULABLE",
      segment_reason_code: "HOLIDAY_COVERAGE_UNKNOWN",
      covered_seconds: null,
      outside_coverage_seconds: null,
      is_holiday: false
    })
  );
});

test("holiday_coverage_status=COVERAGE_UNKNOWN con is_holiday=NULL -> permitido", { skip: !TEST_DB_URL }, async () => {
  await insertSegment(adminPool, {
    fieldbeat_task_id: 900007,
    holiday_coverage_status: "COVERAGE_UNKNOWN",
    segment_calculation_status: "NOT_CALCULABLE",
    segment_coverage_state: "NOT_CALCULABLE",
    segment_reason_code: "HOLIDAY_COVERAGE_UNKNOWN",
    covered_seconds: null,
    outside_coverage_seconds: null,
    is_holiday: null
  });
});

// ============================================================
// 4. Capa C -- matriz estricta, bicondicional de intervalo, invariantes
// ============================================================
test("data_basis=NONE con covered_seconds no NULL -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910002,
      calculation_status: "NOT_CALCULABLE",
      coverage_classification: "NOT_CALCULABLE",
      coverage_reason_code: "NO_EQUIPMENT",
      contractual_attempt_status: "NOT_CALCULABLE",
      contractual_coverage_classification: "NOT_CALCULABLE",
      contractual_reason_code: "NO_EQUIPMENT",
      data_basis: "NONE",
      contract_resolution_confidence: null,
      covered_seconds: 100
    })
  );
});

test("data_basis=CONTRACTUAL con contract_resolution_confidence NULL -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertCapaC(adminPool, { fieldbeat_task_id: 910003, contract_resolution_confidence: null }));
});

test("data_basis=CONTRACTUAL con contractual_attempt_status=NOT_CALCULABLE -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertCapaC(adminPool, { fieldbeat_task_id: 910004, contractual_attempt_status: "NOT_CALCULABLE" }));
});

test("data_basis=LEGACY_SCHEDULE con contractual_attempt_status=CALCULATED -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910005,
      data_basis: "LEGACY_SCHEDULE",
      fallback_used: true,
      coverage_reason_code: "WITHIN_LEGACY_SCHEDULE",
      contractual_attempt_status: "CALCULATED", // inválido: debería ser NOT_CALCULABLE
      contract_resolution_confidence: null
    })
  );
});

test("data_basis=NONE con coverage_reason_code=WITHIN_MATCHED_CONTRACT -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910006,
      calculation_status: "NOT_CALCULABLE",
      coverage_classification: "NOT_CALCULABLE",
      coverage_reason_code: "WITHIN_MATCHED_CONTRACT", // inválido bajo NONE
      contractual_attempt_status: "NOT_CALCULABLE",
      contractual_coverage_classification: "NOT_CALCULABLE",
      contractual_reason_code: "NO_EQUIPMENT",
      data_basis: "NONE",
      contract_resolution_confidence: null,
      start_time_utc: null, end_time_utc: null, duration_seconds: null,
      covered_seconds: null, outside_coverage_seconds: null, after_hours_weekday_seconds: null,
      weekend_seconds: null, holiday_seconds: null, after_hours_total_seconds: null,
      after_hours_rate: null, is_after_hours_task: null
    })
  );
});

test("matriz contractual completa: contractual_attempt_status=CALCULATED con reason que NO es de éxito -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910007,
      contractual_attempt_status: "CALCULATED",
      contractual_coverage_classification: "FULLY_COVERED",
      contractual_reason_code: "NO_EQUIPMENT" // no es un código de éxito -inconsistente con CALCULATED
    })
  );
});

test("bicondicional de intervalo: reason NO terminal con start_time_utc NULL -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910008,
      calculation_status: "NOT_CALCULABLE",
      coverage_classification: "NOT_CALCULABLE",
      coverage_reason_code: "NO_EQUIPMENT", // no terminal
      contractual_attempt_status: "NOT_CALCULABLE",
      contractual_coverage_classification: "NOT_CALCULABLE",
      contractual_reason_code: "NO_EQUIPMENT",
      data_basis: "NONE",
      contract_resolution_confidence: null,
      start_time_utc: null, end_time_utc: null, duration_seconds: null, // inválido: reason no-terminal exige intervalo no-NULL
      covered_seconds: null, outside_coverage_seconds: null, after_hours_weekday_seconds: null,
      weekend_seconds: null, holiday_seconds: null, after_hours_total_seconds: null,
      after_hours_rate: null, is_after_hours_task: null
    })
  );
});

test("bicondicional de intervalo: reason terminal (INVALID_START_TIME) con intervalo NO NULL -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910009,
      calculation_status: "NOT_CALCULABLE",
      coverage_classification: "NOT_CALCULABLE",
      coverage_reason_code: "INVALID_START_TIME",
      contractual_attempt_status: "NOT_CALCULABLE",
      contractual_coverage_classification: "NOT_CALCULABLE",
      contractual_reason_code: "INVALID_START_TIME",
      data_basis: "NONE",
      contract_resolution_confidence: null,
      start_time_utc: "2026-08-10T20:00:00Z", // inválido: terminal exige NULL
      end_time_utc: "2026-08-10T21:00:00Z",
      duration_seconds: 3600,
      covered_seconds: null, outside_coverage_seconds: null, after_hours_weekday_seconds: null,
      weekend_seconds: null, holiday_seconds: null, after_hours_total_seconds: null,
      after_hours_rate: null, is_after_hours_task: null
    })
  );
});

test("motivo terminal + intervalo NULL, bajo NONE -> permitido (caso C del ejemplo trabajado)", { skip: !TEST_DB_URL }, async () => {
  await insertCapaC(adminPool, {
    fieldbeat_task_id: 910010,
    calculation_status: "NOT_CALCULABLE",
    coverage_classification: "NOT_CALCULABLE",
    coverage_reason_code: "INVALID_START_TIME",
    contractual_attempt_status: "NOT_CALCULABLE",
    contractual_coverage_classification: "NOT_CALCULABLE",
    contractual_reason_code: "INVALID_START_TIME",
    data_basis: "NONE",
    contract_resolution_confidence: null,
    start_time_utc: null, end_time_utc: null, duration_seconds: null,
    covered_seconds: null, outside_coverage_seconds: null, after_hours_weekday_seconds: null,
    weekend_seconds: null, holiday_seconds: null, after_hours_total_seconds: null,
    after_hours_rate: null, is_after_hours_task: null
  });
});

test("invariante: weekday+weekend+holiday != after_hours_total -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910011,
      after_hours_weekday_seconds: 10,
      weekend_seconds: 0,
      holiday_seconds: 0,
      after_hours_total_seconds: 999 // no coincide con la suma
    })
  );
});

test("invariante: outside_coverage_seconds != after_hours_total_seconds -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910012,
      covered_seconds: 1800,
      outside_coverage_seconds: 1800,
      duration_seconds: 3600,
      after_hours_weekday_seconds: 900,
      weekend_seconds: 0,
      holiday_seconds: 0,
      after_hours_total_seconds: 900 // debería ser igual a outside_coverage_seconds (1800)
    })
  );
});

test("invariante: is_after_hours_task inconsistente con after_hours_total_seconds > 0 -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() =>
    insertCapaC(adminPool, {
      fieldbeat_task_id: 910013,
      covered_seconds: 1800,
      outside_coverage_seconds: 1800,
      duration_seconds: 3600,
      after_hours_weekday_seconds: 1800,
      weekend_seconds: 0,
      holiday_seconds: 0,
      after_hours_total_seconds: 1800,
      after_hours_rate: 0.5,
      is_after_hours_task: false // debería ser true (total > 0)
    })
  );
});

test("invariante: after_hours_rate no coincide con la política de redondeo -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertCapaC(adminPool, { fieldbeat_task_id: 910014, after_hours_rate: 0.9999 }));
});

test("timestamp con sub-segundo en Capa C -> rechazado", { skip: !TEST_DB_URL }, async () => {
  await assert.rejects(() => insertCapaC(adminPool, { fieldbeat_task_id: 910015, start_time_utc: "2026-08-10T20:00:00.250Z" }));
});

test("fila válida completa -> aceptada (caso A2 sano de control)", { skip: !TEST_DB_URL }, async () => {
  await insertCapaC(adminPool, { fieldbeat_task_id: 910016 });
});

test("estructural: Capa C no tiene columnas contract_valid_from/match_status/parse_status/primary_equipment_key", { skip: !TEST_DB_URL }, async () => {
  const r = await adminPool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'marts' AND table_name = 'fieldbeat_working_hours_analysis_v2'
      AND column_name IN ('contract_valid_from', 'contract_valid_to', 'match_status', 'parse_status', 'primary_equipment_key')
  `);
  assert.equal(r.rows.length, 0);
});

test("estructural: Capa C persiste procedencia temporal y campos normalizados/raw sin ambigüedad", { skip: !TEST_DB_URL }, async () => {
  const expected = [
    "analysis_interval_basis", "analysis_fallback_used", "analysis_fallback_reason",
    "reported_work_start_utc", "reported_work_start_local", "reported_work_start_raw", "reported_work_start_parse_status",
    "reported_work_end_utc", "reported_work_end_local", "reported_work_end_raw", "reported_work_end_parse_status",
    "delivered_at_utc", "delivered_at_local", "delivered_raw", "delivered_parse_status", "temporal_issue_codes"
  ];
  const r = await adminPool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'marts' AND table_name = 'fieldbeat_working_hours_analysis_v2'
      AND column_name = ANY($1::text[])
  `, [expected]);
  assert.deepEqual(r.rows.map(row => row.column_name).sort(), [...expected].sort());
});

// ============================================================
// 5. Tabla puente
// ============================================================
test("2 filas is_primary=true para el mismo working_hours_id -> rechazado", { skip: !TEST_DB_URL }, async () => {
  const cap = await insertCapaC(adminPool, { fieldbeat_task_id: 910017 });
  const whId = cap.rows[0].working_hours_id;

  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_equipment_links
      (working_hours_id, fieldbeat_equipment_key, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
     VALUES ($1, 'FB-A', 'FULLY_COVERED', 'WITHIN_MATCHED_CONTRACT', 'fp-a', true)`,
    [whId]
  );
  await assert.rejects(() =>
    adminPool.query(
      `INSERT INTO marts.fieldbeat_working_hours_equipment_links
        (working_hours_id, fieldbeat_equipment_key, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
       VALUES ($1, 'FB-B', 'FULLY_COVERED', 'WITHIN_MATCHED_CONTRACT', 'fp-b', true)`,
      [whId]
    )
  );
});

test("coverage_fingerprint no NULL con equipment_coverage_classification=NOT_CALCULABLE -> rechazado", { skip: !TEST_DB_URL }, async () => {
  const cap = await insertCapaC(adminPool, { fieldbeat_task_id: 910018 });
  const whId = cap.rows[0].working_hours_id;
  await assert.rejects(() =>
    adminPool.query(
      `INSERT INTO marts.fieldbeat_working_hours_equipment_links
        (working_hours_id, fieldbeat_equipment_key, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
       VALUES ($1, 'FB-C', 'NOT_CALCULABLE', 'EQUIPMENT_UNMATCHED', 'fp-no-deberia-existir', false)`,
      [whId]
    )
  );
});

test("validate_equipment_links_cardinality: exactamente 1 primario en WITHIN_MATCHED_CONTRACT -> true", { skip: !TEST_DB_URL }, async () => {
  const cap = await insertCapaC(adminPool, { fieldbeat_task_id: 910019 });
  const whId = cap.rows[0].working_hours_id;
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_equipment_links
      (working_hours_id, fieldbeat_equipment_key, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
     VALUES ($1, 'FB-D', 'FULLY_COVERED', 'WITHIN_MATCHED_CONTRACT', 'fp-d', true)`,
    [whId]
  );
  const r = await adminPool.query(`SELECT marts.validate_equipment_links_cardinality($1) AS ok`, [whId]);
  assert.equal(r.rows[0].ok, true);
});

test("validate_equipment_links_cardinality: 0 primarios bajo MULTIPLE_EQUIPMENT_CONFLICT -> true; 1 primario -> false", { skip: !TEST_DB_URL }, async () => {
  const cap = await insertCapaC(adminPool, {
    fieldbeat_task_id: 910020,
    calculation_status: "CALCULATED",
    coverage_classification: "FULLY_COVERED", // igual, data_basis=LEGACY_SCHEDULE luego del fallback
    coverage_reason_code: "WITHIN_LEGACY_SCHEDULE",
    contractual_attempt_status: "NOT_CALCULABLE",
    contractual_coverage_classification: "NOT_CALCULABLE",
    contractual_reason_code: "MULTIPLE_EQUIPMENT_CONFLICT",
    fallback_used: true,
    data_basis: "LEGACY_SCHEDULE",
    contract_resolution_confidence: null
  });
  const whId = cap.rows[0].working_hours_id;

  const okEmpty = await adminPool.query(`SELECT marts.validate_equipment_links_cardinality($1) AS ok`, [whId]);
  assert.equal(okEmpty.rows[0].ok, true);

  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_equipment_links
      (working_hours_id, fieldbeat_equipment_key, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
     VALUES ($1, 'FB-E', 'FULLY_COVERED', 'WITHIN_MATCHED_CONTRACT', 'fp-e', true)`,
    [whId]
  );
  const okWithPrimary = await adminPool.query(`SELECT marts.validate_equipment_links_cardinality($1) AS ok`, [whId]);
  assert.equal(okWithPrimary.rows[0].ok, false);
});

// ============================================================
// 6. Vista de transición
// ============================================================
test("vista: fila de Capa C con data_basis=NONE se expone tal cual (sin filtrar), contractual_* visibles", { skip: !TEST_DB_URL }, async () => {
  await adminPool.query(`INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id) VALUES (920001) ON CONFLICT DO NOTHING`);
  await insertCapaC(adminPool, {
    fieldbeat_task_id: 920001,
    calculation_status: "NOT_CALCULABLE",
    coverage_classification: "NOT_CALCULABLE",
    coverage_reason_code: "MULTIPLE_EQUIPMENT_CONFLICT",
    contractual_attempt_status: "NOT_CALCULABLE",
    contractual_coverage_classification: "NOT_CALCULABLE",
    contractual_reason_code: "MULTIPLE_EQUIPMENT_CONFLICT",
    data_basis: "NONE",
    contract_resolution_confidence: null,
    // MULTIPLE_EQUIPMENT_CONFLICT no es un motivo terminal de intervalo -el
    // intervalo SÍ se resolvió (sabemos start/end/duración), solo la
    // cobertura no es calculable por el conflicto entre equipos. El
    // bicondicional real del intervalo (sql/081) exige que el intervalo
    // permanezca no-NULL en este caso.
    start_time_utc: "2026-08-12T20:00:00Z", end_time_utc: "2026-08-12T21:00:00Z", duration_seconds: 3600,
    covered_seconds: null, outside_coverage_seconds: null, after_hours_weekday_seconds: null,
    weekend_seconds: null, holiday_seconds: null, after_hours_total_seconds: null,
    after_hours_rate: null, is_after_hours_task: null
  });
  const r = await adminPool.query(`SELECT data_basis, calculation_status, contractual_reason_code, calculated_at FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id = 920001`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].data_basis, "NONE");
  assert.equal(r.rows[0].calculation_status, "NOT_CALCULABLE");
  assert.equal(r.rows[0].contractual_reason_code, "MULTIPLE_EQUIPMENT_CONFLICT");
  assert.notEqual(r.rows[0].calculated_at, null); // Capa C SIEMPRE tiene calculated_at real (NOT NULL DEFAULT now())
});

test("vista: mart legado solo actúa como relleno cuando Capa C NO tiene fila; calculated_at NULL en ese caso", { skip: !TEST_DB_URL }, async () => {
  await adminPool.query(`INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id) VALUES (920002) ON CONFLICT DO NOTHING`);
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis (fieldbeat_task_id, calculation_status, business_minutes, after_hours_total_minutes)
     VALUES (920002, 'CALCULATED', 60, 10)`
  );
  const r = await adminPool.query(`SELECT data_basis, calculated_at, business_minutes FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id = 920002`);
  assert.equal(r.rows[0].data_basis, "LEGACY_SCHEDULE");
  assert.equal(r.rows[0].calculated_at, null);
  assert.equal(Number(r.rows[0].business_minutes), 60);
});

test("vista: tarea sin Capa C ni mart legado -> data_basis=NONE, calculated_at NULL", { skip: !TEST_DB_URL }, async () => {
  await adminPool.query(`INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id) VALUES (920003) ON CONFLICT DO NOTHING`);
  const r = await adminPool.query(`SELECT data_basis, calculated_at FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id = 920003`);
  assert.equal(r.rows[0].data_basis, "NONE");
  assert.equal(r.rows[0].calculated_at, null);
});

test("vista: deriva minutos correctamente desde segundos (duration_seconds=3600 -> duration_minutes=60)", { skip: !TEST_DB_URL }, async () => {
  await adminPool.query(`INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id) VALUES (920004) ON CONFLICT DO NOTHING`);
  await insertCapaC(adminPool, { fieldbeat_task_id: 920004 });
  const r = await adminPool.query(`SELECT duration_minutes, business_minutes FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id = 920004`);
  assert.equal(Number(r.rows[0].duration_minutes), 60);
  assert.equal(Number(r.rows[0].business_minutes), 60);
});

test("vista: resuelve primary_equipment_key vía JOIN a la tabla puente (is_primary), NULL bajo conflicto", { skip: !TEST_DB_URL }, async () => {
  await adminPool.query(`INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id) VALUES (920005) ON CONFLICT DO NOTHING`);
  const cap = await insertCapaC(adminPool, { fieldbeat_task_id: 920005 });
  const whId = cap.rows[0].working_hours_id;
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_equipment_links
      (working_hours_id, fieldbeat_equipment_key, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
     VALUES ($1, 'FB-PRIMARY', 'FULLY_COVERED', 'WITHIN_MATCHED_CONTRACT', 'fp-primary', true)`,
    [whId]
  );
  const r = await adminPool.query(`SELECT primary_equipment_key FROM marts.fieldbeat_working_hours_analysis_current WHERE fieldbeat_task_id = 920005`);
  assert.equal(r.rows[0].primary_equipment_key, "FB-PRIMARY");
});

// ============================================================
// 7. Concurrencia real: 2 conexiones validando coberturas solapadas
// ============================================================
test("concurrencia real: 2 conexiones publicando coberturas solapadas para la misma jurisdicción -> exactamente 1 exitosa", { skip: !TEST_DB_URL }, async () => {
  const poolA = new Pool({ connectionString: TEST_DB_URL });
  const poolB = new Pool({ connectionString: TEST_DB_URL });
  try {
    const impA = await adminPool.query(
      `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
       VALUES ('cal.csv', 'sha-concurrent-a', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`
    );
    const impB = await adminPool.query(
      `INSERT INTO config.holiday_import_runs (source_filename, source_sha256, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
       VALUES ('cal.csv', 'sha-concurrent-b', 0, 0, 0, 0, 'SUCCESS') RETURNING import_id`
    );

    const attemptA = poolA.query(
      `SELECT config.publish_holiday_coverage('CL_TEST_CONCURRENT', daterange('2026-01-01','2026-12-31'), $1, NULL)`,
      [impA.rows[0].import_id]
    );
    const attemptB = poolB.query(
      `SELECT config.publish_holiday_coverage('CL_TEST_CONCURRENT', daterange('2026-06-01','2027-06-01'), $1, NULL)`,
      [impB.rows[0].import_id]
    );

    const results = await Promise.allSettled([attemptA, attemptB]);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");

    assert.equal(fulfilled.length, 1, `se esperaba exactamente 1 publicación exitosa, resultado: ${JSON.stringify(results.map(r => r.status))}`);
    assert.equal(rejected.length, 1);

    const validatedCount = await adminPool.query(
      `SELECT COUNT(*)::int AS n FROM config.holiday_calendar_coverage WHERE jurisdiction = 'CL_TEST_CONCURRENT' AND coverage_status = 'VALIDATED'`
    );
    assert.equal(validatedCount.rows[0].n, 1, "nunca deben quedar 2 coberturas VALIDATED solapadas para la misma jurisdicción");
  } finally {
    await poolA.end();
    await poolB.end();
  }
});

// ============================================================
// 8. Grants -- nexus_app solo SELECT en la vista de transición
// ============================================================
test("grants: nexus_app solo puede SELECT la vista de transición, nada más de 6.6B0", { skip: !TEST_DB_URL }, async () => {
  // Misma contraseña de prueba que test/contracts/db-writer.integration.test.js
  // usa para nexus_app en este Postgres desechable -evita choques si ambas
  // suites corren contra el mismo contenedor en la misma sesión.
  const nexusUrl = TEST_DB_URL.replace(/\/\/[^:]+:[^@]+@/, "//nexus_app:__SET_IN_SUPABASE_DASHBOARD__@");
  const nexusPool = new Pool({ connectionString: nexusUrl });
  try {
    const viewResult = await nexusPool.query("SELECT * FROM marts.fieldbeat_working_hours_analysis_current LIMIT 1");
    assert.ok(viewResult); // SELECT sobre la vista de transición funciona

    await assert.rejects(() => nexusPool.query("SELECT * FROM marts.fieldbeat_contract_coverage_segments LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM marts.fieldbeat_working_hours_analysis_v2 LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM marts.fieldbeat_working_hours_equipment_links LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.holiday_import_runs LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.holiday_calendar_entries LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.holiday_calendar_coverage LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.current_holiday_calendar_entries LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT * FROM config.current_holiday_calendar_coverage LIMIT 1"));
    await assert.rejects(() => nexusPool.query("SELECT config.publish_holiday_coverage('X', daterange('2026-01-01','2026-01-02'), gen_random_uuid(), NULL)"));
    await assert.rejects(() => nexusPool.query("INSERT INTO marts.fieldbeat_working_hours_analysis_v2 DEFAULT VALUES"));
  } finally {
    await nexusPool.end();
  }
});
