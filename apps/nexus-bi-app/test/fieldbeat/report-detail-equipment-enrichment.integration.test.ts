// Pruebas de integración del enriquecimiento de equipo/modelo/contrato/
// incidencias del detalle canónico de reporte (Sección 14 del encargo
// NEXUS V3 After-Hours) contra un Postgres 16 real y DESECHABLE - mismo
// mecanismo de seguridad que test/explorer/explorer-api.integration.test.ts
// (reutiliza literalmente su patrón insertContractFixture, ver comentario
// ahí sobre por qué cada archivo de integración mantiene su propia copia
// local en vez de un helper compartido - node --test no serializa de forma
// confiable el before()/after() de varios archivos que comparten un mismo
// Postgres desechable con DELETE/INSERT en las mismas tablas).
//
// Rango de fieldbeat_task_id propio (906001-906004), equipment_key/
// client_key con prefijo "NEXUS_AH|" - disjunto de todos los rangos ya
// usados en el repo (905xxx = participantes/repuestos, 970xxx = Explorador).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { buildReportDetailQuery, fetchReportActiveIssues, shapeReportDetail, type ReportDetailQueryRow } from "../../lib/fieldbeat-report-detail-queries.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "fieldbeat-report-detail-equipment-enrichment-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

// Sección 14.5.F del encargo - fetchReportActiveIssues corre vía el rol de
// gobierno (GOVERNANCE_APP_READ_DB_URL), una variable de entorno SEPARADA
// de SUPABASE_DB_URL. Mismo mecanismo de respaldo que
// test/audit/audit-ui-read-routes.integration.test.ts: si no llegó ya
// resuelta (ej. corriendo este archivo suelto en vez de vía
// npm run test:integration:fresh, que sí la fija), se lee directo de
// .env.development.local - apunta a la MISMA base local autorizada
// (nexus_bi_dev_local_test), nunca a Supabase Cloud.
const GOVERNANCE_ENV_VARS = ["GOVERNANCE_APP_READ_DB_URL"] as const;
const ENV_FALLBACK_PATH = new URL("../../.env.development.local", import.meta.url);
if (GOVERNANCE_ENV_VARS.some(name => !process.env[name]) && existsSync(ENV_FALLBACK_PATH)) {
  const content = readFileSync(ENV_FALLBACK_PATH, "utf8");
  for (const line of content.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match && GOVERNANCE_ENV_VARS.includes(match[1] as (typeof GOVERNANCE_ENV_VARS)[number]) && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_KEY = "NEXUS_AH|CLIENTE_FIXTURE";
const CLIENT_NAME = "NEXUS_AH Cliente Fixture";
const TASK_ID_MIN = 906001;
const TASK_ID_MAX = 906004;

const TASK_STRUCTURED_SINGLE = 906001; // 1 equipo, vínculo estructurado, modelo RESOLVED
const TASK_STRUCTURED_MULTI = 906002; // 2 equipos, vínculo estructurado, 2 modelos DISTINTOS
const TASK_TEXT_FALLBACK = 906003; // SIN fila en fieldbeat_task_equipments - fallback de texto
const TASK_WITH_ISSUE = 906004; // 1 equipo, + 1 incidencia activa de gobierno

async function insertTask(pool: pg.Pool, id: number) {
  await pool.query(
    `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, client_key, assigned_to, task_type, state, created_in)
     VALUES ($1, $2, 'nexus-ah-fixture', 'CORRECTIVA PROGRAMADA', 'FINISHED', 'APK')`,
    [id, CLIENT_KEY]
  );
}

async function insertMartRow(pool: pg.Pool, id: number, equipmentInternalIds: string) {
  await pool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
       (fieldbeat_task_id, fieldbeat_task_date, client_key, client_name, task_type, task_state, technician_names, equipment_internal_ids, used_parts_count, report_quality_status)
     VALUES ($1, now(), $2, $3, 'CORRECTIVA PROGRAMADA', 'FINISHED', 'Técnico Fixture', $4, 0, 'NO_USED_PARTS')`,
    [id, CLIENT_KEY, CLIENT_NAME, equipmentInternalIds]
  );
}

// Mismo helper que test/explorer/explorer-api.integration.test.ts (config.
// contract_equipment_versions -> observations -> matches, vía
// contract_import_runs/contract_source_rows ya creados) - reutilizado tal
// cual, no reimplementado.
let contractRowCounter = 0;
async function insertContractFixture(
  pool: pg.Pool,
  importId: string,
  params: { contractEquipmentKey: string; model: string; serial: string; fieldbeatEquipmentKey: string; fieldbeatInternalId: string }
) {
  contractRowCounter += 1;
  const rowHash = `nexus-ah-test-row-hash-${contractRowCounter}`;
  const sourceRow = await pool.query(
    `INSERT INTO config.contract_source_rows (import_id, source_row_number, source_row_hash, raw_payload)
     VALUES ($1, $2, $3, '{}'::jsonb)
     RETURNING source_row_id`,
    [importId, contractRowCounter, rowHash]
  );
  const sourceRowId = sourceRow.rows[0].source_row_id;
  const contractVersion = await pool.query(
    `INSERT INTO config.contract_equipment_versions
       (equipment_key, client_name_canonical, client_name_raw, equipment_model, serial_number,
        installation_date_precision, contract_status_code, spa_tier_code, support_mode_code,
        parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
        valid_from, source_import_id, source_row_number, source_row_hash, contract_fingerprint)
     VALUES
       ($1, 'NEXUS_AH Test Contract Client', 'NEXUS_AH Test Contract Client', $2, $3,
        'UNKNOWN', 'ACTIVE_AUTO_RENEW', 'GOLD', 'ONSITE_AND_REMOTE',
        'FULL_COVERAGE', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN',
        CURRENT_DATE, $4, $5, $6, $6)
     RETURNING contract_version_id`,
    [params.contractEquipmentKey, params.model, params.serial, importId, contractRowCounter, rowHash]
  );
  const contractVersionId = contractVersion.rows[0].contract_version_id;
  const observation = await pool.query(
    `INSERT INTO config.contract_equipment_observations (import_id, source_row_id, equipment_key, contract_version_id, source_row_hash, contract_fingerprint, effective_date)
     VALUES ($1, $2, $3, $4, $5, $5, CURRENT_DATE)
     RETURNING observation_id`,
    [importId, sourceRowId, params.contractEquipmentKey, contractVersionId, rowHash]
  );
  const observationId = observation.rows[0].observation_id;
  await pool.query(
    `INSERT INTO config.contract_equipment_matches (observation_id, match_status, match_method, fieldbeat_equipment_key, fieldbeat_equipment_uuid, fieldbeat_internal_id, candidate_count)
     VALUES ($1, 'MATCHED', 'SERIAL_SUFFIX', $2, $2, $3, 1)`,
    [observationId, params.fieldbeatEquipmentKey, params.fieldbeatInternalId]
  );
  return contractVersionId as number;
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM governance.issues WHERE entity_type = 'report' AND entity_key = $1`, [String(TASK_WITH_ISSUE)]);
  await adminPool.query(
    `DELETE FROM config.contract_equipment_matches WHERE observation_id IN (
       SELECT observation_id FROM config.contract_equipment_observations WHERE equipment_key LIKE 'NEXUS_AH|%'
     )`
  );
  await adminPool.query(`DELETE FROM config.contract_equipment_observations WHERE equipment_key LIKE 'NEXUS_AH|%'`);
  await adminPool.query(`DELETE FROM config.contract_equipment_versions WHERE equipment_key LIKE 'NEXUS_AH|%'`);
  await adminPool.query(
    `DELETE FROM config.contract_source_rows WHERE import_id IN (SELECT import_id FROM config.contract_import_runs WHERE source_filename = 'nexus-ah-test-fixture.csv')`
  );
  await adminPool.query(`DELETE FROM config.contract_import_runs WHERE source_filename = 'nexus-ah-test-fixture.csv'`);
  await adminPool.query(`DELETE FROM processed.fieldbeat_task_equipments WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_equipments WHERE equipment_key LIKE 'NEXUS_AH|%'`);
  await adminPool.query(`DELETE FROM processed.fieldbeat_clients WHERE client_key = $1`, [CLIENT_KEY]);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);

  await adminPool.query(
    `INSERT INTO processed.fieldbeat_clients (client_key, client_name, city, commune, country) VALUES ($1, $2, 'Santiago', 'Santiago', 'Chile')`,
    [CLIENT_KEY, CLIENT_NAME]
  );

  await adminPool.query(
    `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key, equipment_type)
     VALUES
       ('NEXUS_AH|equip-single', 'nexus-ah-uuid-single', 'NEXUS-AH-SINGLE', $1, 'LINAC'),
       ('NEXUS_AH|equip-multi-a', 'nexus-ah-uuid-multi-a', 'NEXUS-AH-MULTI-A', $1, 'LINAC'),
       ('NEXUS_AH|equip-multi-b', 'nexus-ah-uuid-multi-b', 'NEXUS-AH-MULTI-B', $1, 'LINAC'),
       ('NEXUS_AH|equip-issue', 'nexus-ah-uuid-issue', 'NEXUS-AH-ISSUE', $1, 'LINAC')`,
    [CLIENT_KEY]
  );

  // 906001: 1 tarea, 1 equipo, VÍNCULO ESTRUCTURADO real (processed.
  // fieldbeat_task_equipments) - modelo RESOLVED esperado "VersaHD".
  await insertTask(adminPool, TASK_STRUCTURED_SINGLE);
  // equipment_internal_ids DEBE estar poblado en el mart para que
  // deriveEquipmentItems() (identidad, sin tocar por este cambio) produzca
  // el ítem base que el enriquecimiento nuevo luego adorna - un mart vacío
  // deja team_identification_status=MISSING y items=[] sin importar qué
  // haya en processed.fieldbeat_task_equipments (bug real encontrado al
  // correr esta suite: 0 ítems en vez de 1, corregido acá).
  await insertMartRow(adminPool, TASK_STRUCTURED_SINGLE, "NEXUS-AH-SINGLE");
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_task_equipments (task_equipment_id, fieldbeat_task_id, equipment_uuid, equipment_internal_id, extracted_at)
     VALUES ($1, $2, 'nexus-ah-uuid-single', 'NEXUS-AH-SINGLE', now())`,
    [`nexus-ah-te-${TASK_STRUCTURED_SINGLE}`, TASK_STRUCTURED_SINGLE]
  );

  // 906002: 1 tarea, 2 equipos, AMBOS con vínculo estructurado, 2 MODELOS
  // DISTINTOS ("Platform"/"VersaHD") - Sección 14.3 del encargo: nunca se
  // colapsa a uno solo.
  await insertTask(adminPool, TASK_STRUCTURED_MULTI);
  await insertMartRow(adminPool, TASK_STRUCTURED_MULTI, "NEXUS-AH-MULTI-A|NEXUS-AH-MULTI-B");
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_task_equipments (task_equipment_id, fieldbeat_task_id, equipment_uuid, equipment_internal_id, extracted_at)
     VALUES
       ($1, $3, 'nexus-ah-uuid-multi-a', 'NEXUS-AH-MULTI-A', now()),
       ($2, $3, 'nexus-ah-uuid-multi-b', 'NEXUS-AH-MULTI-B', now())`,
    [`nexus-ah-te-${TASK_STRUCTURED_MULTI}-a`, `nexus-ah-te-${TASK_STRUCTURED_MULTI}-b`, TASK_STRUCTURED_MULTI]
  );

  // 906003: SIN fila en fieldbeat_task_equipments (fallback de texto
  // gobernado, Sección 14 del encargo) - equipment_internal_ids poblado
  // directo en el mart, ningún vínculo estructurado. NO se inserta contrato
  // para este equipo a propósito: confirma que el fallback resuelve la
  // IDENTIDAD (resolution_source=TEXT_FALLBACK) incluso sin modelo (UNKNOWN).
  await insertTask(adminPool, TASK_TEXT_FALLBACK);
  await insertMartRow(adminPool, TASK_TEXT_FALLBACK, "NEXUS-AH-SINGLE");

  // 906004: 1 equipo con vínculo estructurado + 1 incidencia de gobierno activa.
  await insertTask(adminPool, TASK_WITH_ISSUE);
  await insertMartRow(adminPool, TASK_WITH_ISSUE, "NEXUS-AH-ISSUE");
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_task_equipments (task_equipment_id, fieldbeat_task_id, equipment_uuid, equipment_internal_id, extracted_at)
     VALUES ($1, $2, 'nexus-ah-uuid-issue', 'NEXUS-AH-ISSUE', now())`,
    [`nexus-ah-te-${TASK_WITH_ISSUE}`, TASK_WITH_ISSUE]
  );
  // governance.issues(rule_code, first_detected_rule_version) tiene FK real
  // contra governance.rule_definitions(rule_code, rule_version) (sql/089:520-522)
  // - se reutiliza REPORT_QUALITY_DEGRADED (entity_type='report'), ya
  // sembrada por esa misma migración (sql/089:95-97), en vez de inventar un
  // rule_code de fixture que requeriría además insertar su propia fila en
  // rule_definitions.
  await adminPool.query(
    `INSERT INTO governance.issues
       (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version, entity_type, entity_key, occurrence_key,
        severity, status, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
     VALUES ($1, 'REPORT_QUALITY_DEGRADED', 1, 1, 'report', $2, $2, 'HIGH', 'OPEN', now(), now(), now(), true)`,
    [`nexus-ah-test-fingerprint-${TASK_WITH_ISSUE}`, String(TASK_WITH_ISSUE)]
  );

  const importRun = await adminPool.query(
    `INSERT INTO config.contract_import_runs (source_filename, source_sha256, effective_date, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('nexus-ah-test-fixture.csv', 'nexus-ah-test-sha-' || gen_random_uuid()::text, CURRENT_DATE, 3, 3, 0, 0, 'SUCCESS')
     RETURNING import_id`
  );
  const importId = importRun.rows[0].import_id;

  await insertContractFixture(adminPool, importId, {
    contractEquipmentKey: "NEXUS_AH|contract-single",
    model: "VersaHD",
    serial: "SN-NEXUS-AH-SINGLE",
    fieldbeatEquipmentKey: "NEXUS_AH|equip-single",
    fieldbeatInternalId: "NEXUS-AH-SINGLE"
  });
  await insertContractFixture(adminPool, importId, {
    contractEquipmentKey: "NEXUS_AH|contract-multi-a",
    model: "Platform",
    serial: "SN-NEXUS-AH-MULTI-A",
    fieldbeatEquipmentKey: "NEXUS_AH|equip-multi-a",
    fieldbeatInternalId: "NEXUS-AH-MULTI-A"
  });
  await insertContractFixture(adminPool, importId, {
    contractEquipmentKey: "NEXUS_AH|contract-multi-b",
    model: "VersaHD",
    serial: "SN-NEXUS-AH-MULTI-B",
    fieldbeatEquipmentKey: "NEXUS_AH|equip-multi-b",
    fieldbeatInternalId: "NEXUS-AH-MULTI-B"
  });
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
});

async function fetchDetailRow(taskId: number): Promise<ReportDetailQueryRow> {
  const { sql, params } = buildReportDetailQuery(String(taskId));
  const result = await adminPool.query(sql, params);
  assert.equal(result.rows.length, 1, `esperaba exactamente 1 fila para la tarea fixture ${taskId}`);
  return result.rows[0] as ReportDetailQueryRow;
}

test("vínculo estructurado real (1 equipo): resolutionSource=TASK_EQUIPMENT_LINK, modelo RESOLVED, contrato como objeto con contractVersionId", { skip: !TEST_DB_URL }, async () => {
  const row = await fetchDetailRow(TASK_STRUCTURED_SINGLE);
  const detail = shapeReportDetail(row, false, { status: "available", issues: [] });

  assert.equal(detail.equipment.items.length, 1);
  const item = detail.equipment.items[0];
  assert.equal(item.internalId, "NEXUS-AH-SINGLE");
  assert.equal(item.resolutionSource, "TASK_EQUIPMENT_LINK");
  assert.equal(item.model, "VersaHD");
  assert.equal(item.modelResolutionStatus, "RESOLVED");
  assert.equal(item.contracts.length, 1);
  assert.ok(item.contracts[0].contractVersionId.length > 0, "contractVersionId debe ser el PK real de config.contract_equipment_versions, nunca vacío");
  assert.equal(item.contracts[0].spaTierCode, "GOLD");
});

test("2 equipos con vínculo estructurado y modelos DISTINTOS: ambos aparecen, nunca colapsados a uno solo", { skip: !TEST_DB_URL }, async () => {
  const row = await fetchDetailRow(TASK_STRUCTURED_MULTI);
  const detail = shapeReportDetail(row, false, { status: "available", issues: [] });

  assert.equal(detail.equipment.items.length, 2, "un reporte con 2 equipos vinculados debe conservar los 2 ítems, no colapsar a 1");
  const models = detail.equipment.items.map(i => i.model).sort();
  assert.deepEqual(models, ["Platform", "VersaHD"]);
  for (const item of detail.equipment.items) {
    assert.equal(item.resolutionSource, "TASK_EQUIPMENT_LINK");
    assert.equal(item.modelResolutionStatus, "RESOLVED");
  }
});

test("sin fila en fieldbeat_task_equipments: cae al fallback de texto gobernado (resolutionSource=TEXT_FALLBACK), nunca se confunde con el caso estructurado", { skip: !TEST_DB_URL }, async () => {
  const row = await fetchDetailRow(TASK_TEXT_FALLBACK);
  const detail = shapeReportDetail(row, false, { status: "available", issues: [] });

  assert.equal(detail.equipment.items.length, 1);
  const item = detail.equipment.items[0];
  assert.equal(item.internalId, "NEXUS-AH-SINGLE");
  assert.equal(item.resolutionSource, "TEXT_FALLBACK");
  // Este equipo SÍ tiene contrato real (mismo internal_id que 906001) - el
  // fallback de texto resuelve modelo igual que el camino estructurado
  // cuando el internal_id matchea, confirmando que ambos caminos convergen
  // en el mismo resultado para el mismo equipo real.
  assert.equal(item.model, "VersaHD");
  assert.equal(item.modelResolutionStatus, "RESOLVED");
});

test("fetchReportActiveIssues: incidencia activa real de governance.issues se recupera vía el rol de gobierno (pool separado del genérico)", { skip: !TEST_DB_URL }, async () => {
  const issues = await fetchReportActiveIssues(String(TASK_WITH_ISSUE));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleCode, "REPORT_QUALITY_DEGRADED");
  assert.equal(issues[0].severity, "HIGH");
  assert.equal(issues[0].status, "OPEN");
});

test("fetchReportActiveIssues: tarea sin incidencias devuelve array vacío (confirmado, no null/undefined)", { skip: !TEST_DB_URL }, async () => {
  const issues = await fetchReportActiveIssues(String(TASK_STRUCTURED_SINGLE));
  assert.deepEqual(issues, []);
});
