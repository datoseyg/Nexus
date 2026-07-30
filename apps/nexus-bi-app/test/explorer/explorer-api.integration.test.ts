// Pruebas de integración del Explorador semántico (Gate B, B20-B23) contra un
// Postgres 16 real y DESECHABLE - mismo mecanismo de seguridad que
// test/fieldbeat/*.integration.test.ts. No inserta fixtures propios para
// clients/equipment/products/contracts/technicians (esas tablas se pueblan
// vía scripts de import de datos reales, fuera del bootstrap de esquema) -
// valida en cambio que cada consulta de las 9 entidades es sintáctica y
// referencialmente válida contra el esquema real (columnas existentes,
// joins correctos) incluso con 0 filas, más el contrato de auth/paginación/
// errores. reports/tickets/parts se ejercitan además con fixtures propios
// para confirmar conteos reales.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "explorer-api-gate-b-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_NAME = "EXPLORER_TEST_CLIENT";
const TASK_ID_MIN = 970001;
const TASK_ID_MAX = 970002;
const TICKET_ID = 970099;

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "explorer-api-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

function noSession() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: null, error: null };
    }
  });
}

// Inserta una cadena de contrato mínima y válida (config.contract_equipment_versions
// -> observations -> matches, ambas vía contract_import_runs/contract_source_rows
// ya creados) - reutilizado para probar: (a) que el modelo/serie se resuelve
// sin importar cuál fila física fue enlazada (fixture original), (b) que 2
// contratos con MODELOS distintos vinculados al MISMO equipo canónico
// producen model_resolution_status=AMBIGUOUS (nunca uno elegido en
// silencio), y (c) que 2 contratos con mantenimiento preventivo distinto
// NUNCA se suman/promedian.
let contractRowCounter = 0;
async function insertContractFixture(
  pool: pg.Pool,
  importId: string,
  params: {
    contractEquipmentKey: string;
    model: string;
    serial: string;
    pmMin: number | null;
    pmMax: number | null;
    fieldbeatEquipmentKey: string;
    fieldbeatInternalId: string;
  }
) {
  contractRowCounter += 1;
  const rowHash = `explorer-test-row-hash-${contractRowCounter}`;
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
        preventive_maintenance_min, preventive_maintenance_max,
        valid_from, source_import_id, source_row_number, source_row_hash, contract_fingerprint)
     VALUES
       ($1, 'Explorer Test Contract Client', 'Explorer Test Contract Client', $2, $3,
        'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN',
        'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN',
        $4, $5,
        CURRENT_DATE, $6, $7, $8, $8)
     RETURNING contract_version_id`,
    [params.contractEquipmentKey, params.model, params.serial, params.pmMin, params.pmMax, importId, contractRowCounter, rowHash]
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
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL.");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.zendesk_tickets WHERE zendesk_ticket_id = $1`, [TICKET_ID]);

  await adminPool.query(
    `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, description) VALUES ($1, 'fixture explorer'), ($2, 'fixture explorer 2')`,
    [TASK_ID_MIN, TASK_ID_MAX]
  );
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
      (fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, equipment_internal_ids, linked_zendesk_ticket_id, used_parts_count)
     VALUES
      ($1, now(), $3, 'PM', 'EXP-EQUIP-1', $4::text, 0),
      ($2, now(), $3, 'CM', 'EXP-EQUIP-1', NULL, 0)`,
    [TASK_ID_MIN, TASK_ID_MAX, CLIENT_NAME, TICKET_ID]
  );
  await adminPool.query(
    `INSERT INTO processed.zendesk_tickets (zendesk_ticket_id, subject, status, created_at) VALUES ($1, 'Fixture ticket', 'open', now())`,
    [TICKET_ID]
  );

  // Fixtures de la corrección de duplicados de Clientes (hallazgo real:
  // processed.fieldbeat_clients tiene varias filas físicas por cliente real,
  // típicamente una con `rut` y otra sin él) - ver lib/explorer-sql.ts
  // CLIENTS_CANONICAL_CTE. DUP_CLIENT_KEYS reproduce ese patrón exacto (2
  // filas, mismo nombre, una sin dirección); SHARED_RUT_KEYS reproduce el
  // caso de colisión de RUT real encontrado entre ACME y HOSPITAL CARLOS VAN
  // BUREN (SSVSA) en los datos reales - dos nombres distintos que comparten
  // el mismo `rut` y NUNCA deben fusionarse.
  await adminPool.query(
    `DELETE FROM processed.fieldbeat_clients WHERE client_key = ANY($1)`,
    [[
      "FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT",
      "FIELD_BEAT_CLIENT||EXPLORER_TEST_DUP_CLIENT",
      "FIELD_BEAT_CLIENT|EXPLORER_TEST_SHARED_RUT|EXPLORER_TEST_CLIENT_ALPHA",
      "FIELD_BEAT_CLIENT|EXPLORER_TEST_SHARED_RUT|EXPLORER_TEST_CLIENT_BETA"
    ]]
  );
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_clients (client_key, client_name, rut, fieldbeat_client_name, address_raw, city, commune, country)
     VALUES
       ('FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT', 'EXPLORER_TEST_DUP_CLIENT', 'EXPLORER_TEST_RUT_A', 'EXPLORER_TEST_DUP_CLIENT', 'Calle Uno 123, Santiago', 'Santiago', 'Santiago', 'Chile'),
       ('FIELD_BEAT_CLIENT||EXPLORER_TEST_DUP_CLIENT', 'EXPLORER_TEST_DUP_CLIENT', NULL, 'EXPLORER_TEST_DUP_CLIENT', NULL, NULL, NULL, NULL),
       ('FIELD_BEAT_CLIENT|EXPLORER_TEST_SHARED_RUT|EXPLORER_TEST_CLIENT_ALPHA', 'EXPLORER_TEST_CLIENT_ALPHA', 'EXPLORER_TEST_SHARED_RUT', 'EXPLORER_TEST_CLIENT_ALPHA', 'Calle Dos 456, Santiago', 'Santiago', 'Santiago', 'Chile'),
       ('FIELD_BEAT_CLIENT|EXPLORER_TEST_SHARED_RUT|EXPLORER_TEST_CLIENT_BETA', 'EXPLORER_TEST_CLIENT_BETA', 'EXPLORER_TEST_SHARED_RUT', 'EXPLORER_TEST_CLIENT_BETA', 'Calle Tres 789, Santiago', 'Santiago', 'Santiago', 'Chile')`
  );

  // Fixtures de la corrección de duplicados de Equipos (hallazgo real leyendo
  // directamente processed.fieldbeat_equipments: 85 filas físicas para 58
  // equipos reales - ver EQUIPMENT_CANONICAL_CTE en lib/explorer-sql.ts).
  // Reproduce EN UNA SOLA fixture las dos causas confirmadas a la vez: (a)
  // equipment_uuid inestable entre ocurrencias del mismo equipo físico (una
  // fila con uuid real, otra con uuid vacío) y (b) mayúsculas/minúsculas
  // distintas en internal_id para el MISMO equipo - además vinculadas a las
  // DOS filas físicas de cliente (con rut / sin rut) ya fijadas arriba, para
  // confirmar que las tres fragmentaciones colapsan juntas a 1 solo equipo.
  // TRIPLE_EQUIP reproduce el patrón exacto de INC-INFINITY01/TPS-CAS (3
  // ocurrencias reales: uuid real, uuid vacío, Y uuid literalmente igual al
  // propio internal_id - dato de origen de FieldBeat, no de esta app).
  await adminPool.query(
    `DELETE FROM processed.fieldbeat_equipments WHERE equipment_key = ANY($1)`,
    [[
      "FIELDBEAT_EQUIPMENT|explorer-test-equip-uuid|EXPLORER_TEST_DUP_EQUIP",
      "FIELDBEAT_EQUIPMENT||explorer_test_dup_equip",
      "FIELDBEAT_EQUIPMENT|explorer-test-triple-uuid|EXPLORER_TEST_TRIPLE_EQUIP",
      "FIELDBEAT_EQUIPMENT||EXPLORER_TEST_TRIPLE_EQUIP",
      "FIELDBEAT_EQUIPMENT|EXPLORER_TEST_TRIPLE_EQUIP|EXPLORER_TEST_TRIPLE_EQUIP",
      "FIELDBEAT_EQUIPMENT|explorer-test-ambig-uuid|EXPLORER_TEST_AMBIG_EQUIP"
    ]]
  );
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key, equipment_type)
     VALUES
       ('FIELDBEAT_EQUIPMENT|explorer-test-equip-uuid|EXPLORER_TEST_DUP_EQUIP', 'explorer-test-equip-uuid', 'EXPLORER_TEST_DUP_EQUIP', 'FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT', 'TEST_TYPE'),
       ('FIELDBEAT_EQUIPMENT||explorer_test_dup_equip', '', 'explorer_test_dup_equip', 'FIELD_BEAT_CLIENT||EXPLORER_TEST_DUP_CLIENT', NULL),
       ('FIELDBEAT_EQUIPMENT|explorer-test-triple-uuid|EXPLORER_TEST_TRIPLE_EQUIP', 'explorer-test-triple-uuid', 'EXPLORER_TEST_TRIPLE_EQUIP', 'FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT', 'TEST_TYPE'),
       ('FIELDBEAT_EQUIPMENT||EXPLORER_TEST_TRIPLE_EQUIP', '', 'EXPLORER_TEST_TRIPLE_EQUIP', 'FIELD_BEAT_CLIENT||EXPLORER_TEST_DUP_CLIENT', NULL),
       ('FIELDBEAT_EQUIPMENT|EXPLORER_TEST_TRIPLE_EQUIP|EXPLORER_TEST_TRIPLE_EQUIP', 'EXPLORER_TEST_TRIPLE_EQUIP', 'EXPLORER_TEST_TRIPLE_EQUIP', 'FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT', NULL),
       ('FIELDBEAT_EQUIPMENT|explorer-test-ambig-uuid|EXPLORER_TEST_AMBIG_EQUIP', 'explorer-test-ambig-uuid', 'EXPLORER_TEST_AMBIG_EQUIP', 'FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT', 'TEST_TYPE')`
  );

  const importRun = await adminPool.query(
    `INSERT INTO config.contract_import_runs (source_filename, source_sha256, effective_date, rows_read, rows_accepted, rows_ignored, rows_errored, import_status)
     VALUES ('explorer-test-fixture.csv', 'explorer-test-sha-' || gen_random_uuid()::text, CURRENT_DATE, 3, 3, 0, 0, 'SUCCESS')
     RETURNING import_id`
  );
  const importId = importRun.rows[0].import_id;

  // (a) Modelo/serie se resuelve para el equipo CANÓNICO sin importar cuál
  // fila física fue la efectivamente enlazada (el match apunta a la fila con
  // uuid real, NUNCA a la de uuid vacío - EQUIPMENT_CONTRACT_CANDIDATES_LATERAL
  // usa TODAS las source_equipment_keys, nunca solo una).
  await insertContractFixture(adminPool, importId, {
    contractEquipmentKey: "EXPLORER_TEST_CONTRACT_EQUIP",
    model: "ExplorerTestModel",
    serial: "EXPLORER-TEST-SERIAL",
    pmMin: 2,
    pmMax: 2,
    fieldbeatEquipmentKey: "FIELDBEAT_EQUIPMENT|explorer-test-equip-uuid|EXPLORER_TEST_DUP_EQUIP",
    fieldbeatInternalId: "EXPLORER_TEST_DUP_EQUIP"
  });

  // (b)+(c) DOS contratos distintos vinculados al MISMO equipo canónico
  // (EXPLORER_TEST_AMBIG_EQUIP), con modelo Y mantenimiento preventivo
  // EN DESACUERDO - nunca se elige uno ni se promedian/suman las cifras.
  await insertContractFixture(adminPool, importId, {
    contractEquipmentKey: "EXPLORER_TEST_AMBIG_CONTRACT_A",
    model: "ExplorerModelA",
    serial: "EXPLORER-AMBIG-SERIAL-A",
    pmMin: 2,
    pmMax: 2,
    fieldbeatEquipmentKey: "FIELDBEAT_EQUIPMENT|explorer-test-ambig-uuid|EXPLORER_TEST_AMBIG_EQUIP",
    fieldbeatInternalId: "EXPLORER_TEST_AMBIG_EQUIP"
  });
  await insertContractFixture(adminPool, importId, {
    contractEquipmentKey: "EXPLORER_TEST_AMBIG_CONTRACT_B",
    model: "ExplorerModelB",
    serial: "EXPLORER-AMBIG-SERIAL-B",
    pmMin: 4,
    pmMax: 4,
    fieldbeatEquipmentKey: "FIELDBEAT_EQUIPMENT|explorer-test-ambig-uuid|EXPLORER_TEST_AMBIG_EQUIP",
    fieldbeatInternalId: "EXPLORER_TEST_AMBIG_EQUIP"
  });
});

afterAll(async () => {
  if (!TEST_DB_URL) return;
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [TASK_ID_MIN, TASK_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.zendesk_tickets WHERE zendesk_ticket_id = $1`, [TICKET_ID]);
  const CONTRACT_EQUIPMENT_KEYS = ["EXPLORER_TEST_CONTRACT_EQUIP", "EXPLORER_TEST_AMBIG_CONTRACT_A", "EXPLORER_TEST_AMBIG_CONTRACT_B"];
  // Orden inverso de FKs: matches -> observations -> versions -> source_rows -> import_runs.
  await adminPool.query(
    `DELETE FROM config.contract_equipment_matches WHERE observation_id IN (
       SELECT observation_id FROM config.contract_equipment_observations WHERE equipment_key = ANY($1)
     )`,
    [CONTRACT_EQUIPMENT_KEYS]
  );
  await adminPool.query(`DELETE FROM config.contract_equipment_observations WHERE equipment_key = ANY($1)`, [CONTRACT_EQUIPMENT_KEYS]);
  await adminPool.query(`DELETE FROM config.contract_equipment_versions WHERE equipment_key = ANY($1)`, [CONTRACT_EQUIPMENT_KEYS]);
  await adminPool.query(
    `DELETE FROM config.contract_source_rows WHERE import_id IN (SELECT import_id FROM config.contract_import_runs WHERE source_filename = 'explorer-test-fixture.csv')`
  );
  await adminPool.query(`DELETE FROM config.contract_import_runs WHERE source_filename = 'explorer-test-fixture.csv'`);
  await adminPool.query(
    `DELETE FROM processed.fieldbeat_equipments WHERE equipment_key = ANY($1)`,
    [[
      "FIELDBEAT_EQUIPMENT|explorer-test-equip-uuid|EXPLORER_TEST_DUP_EQUIP",
      "FIELDBEAT_EQUIPMENT||explorer_test_dup_equip",
      "FIELDBEAT_EQUIPMENT|explorer-test-triple-uuid|EXPLORER_TEST_TRIPLE_EQUIP",
      "FIELDBEAT_EQUIPMENT||EXPLORER_TEST_TRIPLE_EQUIP",
      "FIELDBEAT_EQUIPMENT|EXPLORER_TEST_TRIPLE_EQUIP|EXPLORER_TEST_TRIPLE_EQUIP",
      "FIELDBEAT_EQUIPMENT|explorer-test-ambig-uuid|EXPLORER_TEST_AMBIG_EQUIP"
    ]]
  );
  await adminPool.query(
    `DELETE FROM processed.fieldbeat_clients WHERE client_key = ANY($1)`,
    [[
      "FIELD_BEAT_CLIENT|EXPLORER_TEST_RUT_A|EXPLORER_TEST_DUP_CLIENT",
      "FIELD_BEAT_CLIENT||EXPLORER_TEST_DUP_CLIENT",
      "FIELD_BEAT_CLIENT|EXPLORER_TEST_SHARED_RUT|EXPLORER_TEST_CLIENT_ALPHA",
      "FIELD_BEAT_CLIENT|EXPLORER_TEST_SHARED_RUT|EXPLORER_TEST_CLIENT_BETA"
    ]]
  );
  await adminPool.end();
});

const ALL_ENTITIES = ["clients", "equipment", "technicians", "reports", "tickets", "parts", "products", "contracts", "issues"];

test("GET /api/explorer/[entity] - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/explorer/[entity]/route.ts");

  await t.test("401 sin sesión", async () => {
    noSession();
    const response = await GET(req("/api/explorer/reports"), { params: Promise.resolve({ entity: "reports" }) });
    assert.equal(response.status, 401);
  });

  await t.test("404 para entidad desconocida", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/bogus-entity"), { params: Promise.resolve({ entity: "bogus-entity" }) });
    assert.equal(response.status, 404);
  });

  for (const entity of ALL_ENTITIES) {
    await t.test(`200 con forma válida para entidad "${entity}"`, async () => {
      asGerencia();
      const response = await GET(req(`/api/explorer/${entity}?page=1&pageSize=25`), { params: Promise.resolve({ entity }) });
      assert.equal(response.status, 200, `esperado 200 para ${entity}`);
      const body = await response.json();
      assert.equal(body.entity, entity);
      assert.equal(body.page, 1);
      assert.equal(body.pageSize, 25);
      assert.ok(Array.isArray(body.rows));
      assert.ok(typeof body.totalRows === "number");
      assert.ok(typeof body.totalPages === "number");
    });
  }

  await t.test("reports: fixtures reales aparecen en el listado", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/reports?page=1&pageSize=100"), { params: Promise.resolve({ entity: "reports" }) });
    const body = await response.json();
    const ids = body.rows.map((r: { fieldbeat_task_id: unknown }) => Number(r.fieldbeat_task_id));
    assert.ok(ids.includes(TASK_ID_MIN) && ids.includes(TASK_ID_MAX));
  });

  await t.test("tickets: fixture real aparece en el listado", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/tickets?page=1&pageSize=100"), { params: Promise.resolve({ entity: "tickets" }) });
    const body = await response.json();
    const ids = body.rows.map((r: { zendesk_ticket_id: unknown }) => Number(r.zendesk_ticket_id));
    assert.ok(ids.includes(TICKET_ID));
  });

  // Contrato de identidad de Cliente (corrección real: processed.fieldbeat_clients
  // tiene varias filas físicas por cliente real - ver CLIENTS_CANONICAL_CTE en
  // lib/explorer-sql.ts). Nunca más SELECT DISTINCT como parche ni deduplicación
  // solo en el CSV - la garantía vive en la consulta semántica, compartida por
  // listado y exportación.
  await t.test("clients: nombre duplicado con distinto client_key colapsa a exactamente 1 fila canónica", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/clients?q=EXPLORER_TEST_DUP_CLIENT&page=1&pageSize=25"), { params: Promise.resolve({ entity: "clients" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const matches = body.rows.filter((r: { client_name: unknown }) => r.client_name === "EXPLORER_TEST_DUP_CLIENT");
    assert.equal(matches.length, 1, "2 filas físicas del mismo cliente deben colapsar a 1 fila, nunca aparecer 2 veces");
    assert.equal(Number(matches[0].location_count), 1, "una dirección real + una fila incompleta sin dirección -> 1 sede real, no 2");
  });

  await t.test("clients: mismo rut, nombre distinto -> nunca se fusionan (rut no es la clave canónica)", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/clients?q=EXPLORER_TEST_CLIENT_&page=1&pageSize=25"), { params: Promise.resolve({ entity: "clients" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const names = body.rows.map((r: { client_name: unknown }) => r.client_name);
    assert.ok(names.includes("EXPLORER_TEST_CLIENT_ALPHA"), "ALPHA debe seguir apareciendo pese a compartir rut con BETA");
    assert.ok(names.includes("EXPLORER_TEST_CLIENT_BETA"), "BETA debe seguir apareciendo pese a compartir rut con ALPHA");
    assert.equal(new Set(body.rows.map((r: { client_key: unknown }) => r.client_key)).size, new Set(names).size, "cada nombre distinto conserva su propia clave canónica, ninguna colisiona");
  });

  await t.test("clients: cero client_key canónicos duplicados en todo el universo paginado", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/clients?page=1&pageSize=100"), { params: Promise.resolve({ entity: "clients" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const keys = body.rows.map((r: { client_key: unknown }) => r.client_key);
    assert.equal(new Set(keys).size, keys.length, "ningún client_key canónico puede repetirse dentro de una misma página");
  });

  // Contrato de identidad de Equipo (corrección real: processed.
  // fieldbeat_equipments tiene varias filas físicas por equipo real, tanto
  // por equipment_uuid inestable como por mayúsculas/minúsculas distintas en
  // internal_id - ver EQUIPMENT_CANONICAL_CTE en lib/explorer-sql.ts). La
  // fixture combina ADEMÁS la fragmentación de cliente (rut/sin rut) ya
  // fijada arriba, para confirmar que las tres colapsan juntas.
  await t.test("equipment: uuid inestable + mayúsculas distintas + cliente fragmentado colapsan a exactamente 1 fila canónica", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/equipment?q=EXPLORER_TEST_DUP_EQUIP&page=1&pageSize=25"), { params: Promise.resolve({ entity: "equipment" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rows.length, 1, "2 filas físicas del mismo equipo (uuid inestable + casing distinto) deben colapsar a 1, nunca aparecer 2 veces");
    assert.equal(body.rows[0].internal_id, "EXPLORER_TEST_DUP_EQUIP", "el identificador mostrado está normalizado a mayúsculas, no depende de cuál fila física se haya listado primero");
    assert.equal(body.rows[0].client_name, "EXPLORER_TEST_DUP_CLIENT");
  });

  await t.test("equipment: cero equipment_key canónicos duplicados en todo el universo paginado", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/equipment?page=1&pageSize=100"), { params: Promise.resolve({ entity: "equipment" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const keys = body.rows.map((r: { equipment_key: unknown }) => r.equipment_key);
    assert.equal(new Set(keys).size, keys.length, "ningún equipment_key canónico puede repetirse dentro de una misma página");
  });

  // Reproduce el patrón EXACTO de INC-INFINITY01/TPS-CAS (3 ocurrencias
  // físicas reales: uuid real, uuid vacío, uuid = internal_id literal).
  await t.test("equipment: 3 ocurrencias físicas (patrón INC-INFINITY01/TPS-CAS) colapsan a exactamente 1 fila canónica", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/equipment?q=EXPLORER_TEST_TRIPLE_EQUIP&page=1&pageSize=25"), { params: Promise.resolve({ entity: "equipment" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rows.length, 1, "3 filas físicas del mismo equipo deben colapsar a 1, nunca aparecer 3 veces (INC-INFINITY01/TPS-CAS)");
  });

  // Modelo/mantenimiento preventivo en desacuerdo entre 2 contratos vinculados
  // al MISMO equipo canónico - nunca se elige uno vía MAX/MIN/primera fila,
  // nunca se promedia/suma. model_resolution_status debe declararse AMBIGUOUS
  // y el campo `model` debe quedar en null (nunca "ExplorerModelA" ni
  // "ExplorerModelB" elegido en silencio).
  await t.test("equipment: modelos en conflicto entre 2 contratos -> model_resolution_status=AMBIGUOUS, model=null, ambos candidatos preservados", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/equipment?q=EXPLORER_TEST_AMBIG_EQUIP&page=1&pageSize=25"), { params: Promise.resolve({ entity: "equipment" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rows.length, 1);
    const row = body.rows[0];
    assert.equal(row.model_resolution_status, "AMBIGUOUS");
    assert.equal(row.model, null, "nunca se elige un modelo en silencio cuando hay 2 en desacuerdo");
  });

  await t.test("equipment: detalle expone ambos modelos candidatos (procedencia) cuando el modelo es AMBIGUOUS", async () => {
    const { GET: GETDETAIL } = await import("../../app/api/explorer/detail/route.ts");
    asGerencia();
    const canonicalKey = `EXPLORER_TEST_DUP_CLIENT::EXPLORER_TEST_AMBIG_EQUIP`;
    const response = await GETDETAIL(req(`/api/explorer/detail?entity=equipment&key=${encodeURIComponent(canonicalKey)}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.model_resolution_status, "AMBIGUOUS");
    assert.equal(body.summary.model, null);
    assert.deepEqual([...body.summary.equipment_models].sort(), ["ExplorerModelA", "ExplorerModelB"], "ambos candidatos deben seguir visibles en el detalle, nunca perderse");
  });

  // Mantenimiento preventivo: 2 contratos con 2/año y 4/año - NUNCA se
  // promedian (3) ni se suman (6): ambos valores deben seguir presentes por
  // separado en los datos crudos (formatPreventiveMaintenanceCell, probado
  // vía Playwright end-to-end, decide cómo mostrarlos - acá se prueba que el
  // dato de origen nunca se colapsa a un número fabricado).
  await t.test("equipment: mantenimiento preventivo en conflicto (2/año vs 4/año) nunca se promedia ni se suma en los datos", async () => {
    const { GET: GETDETAIL } = await import("../../app/api/explorer/detail/route.ts");
    asGerencia();
    const canonicalKey = `EXPLORER_TEST_DUP_CLIENT::EXPLORER_TEST_AMBIG_EQUIP`;
    const response = await GETDETAIL(req(`/api/explorer/detail?entity=equipment&key=${encodeURIComponent(canonicalKey)}`));
    const body = await response.json();
    assert.deepEqual([...body.summary.preventive_maintenance_mins].sort(), [2, 4], "los 2 valores en desacuerdo deben seguir presentes por separado, nunca reemplazados por un promedio/suma");
    assert.ok(!body.summary.preventive_maintenance_mins.includes(3), "3 (promedio de 2 y 4) nunca debe aparecer - no es un valor real de ningún contrato");
    assert.ok(!body.summary.preventive_maintenance_mins.includes(6), "6 (suma de 2 y 4) nunca debe aparecer - no es un valor real de ningún contrato");
  });

  // Nota: la paridad UI/exportación no se prueba acá importando
  // app/api/explorer/[entity]/export/route.ts en proceso - esa ruta importa
  // lib/explorer-entity-config.ts, que a su vez importa
  // components/ui/StatusBadge.tsx (JSX real, no solo tipos), y esta suite
  // corre con `node --experimental-strip-types` (ver test/ts-extension-loader.mjs),
  // que no transforma JSX. La paridad está garantizada por construcción
  // (ambas rutas llaman a las MISMAS buildClientsListQuery/countClientsTotal
  // de lib/explorer-sql.ts, confirmado por lectura de
  // app/api/explorer/[entity]/export/route.ts) y fue verificada end-to-end
  // contra el servidor real vía Playwright (26 filas idénticas en listado y
  // CSV exportado, mismos valores de Reportes/Tickets/Incidencias activas
  // por cliente, 0 filas duplicadas).
});

test("GET /api/explorer/detail - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/explorer/detail/route.ts");

  await t.test("400 sin entity/key", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/detail"));
    assert.equal(response.status, 400);
  });

  await t.test("400 ENTITY_RETIRED para entity=reports (usa el drawer canónico)", async () => {
    asGerencia();
    const response = await GET(req(`/api/explorer/detail?entity=reports&key=${TASK_ID_MIN}`));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "ENTITY_RETIRED");
  });

  await t.test("404 para entidad no soportada", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/detail?entity=bogus&key=x"));
    assert.equal(response.status, 404);
  });

  await t.test("200 con identity + summary + related para tickets (fixture real)", async () => {
    asGerencia();
    const response = await GET(req(`/api/explorer/detail?entity=tickets&key=${TICKET_ID}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entity, "tickets");
    assert.equal(body.identity.resolutionStatus, "DIRECT");
    assert.equal(Number(body.summary.ticketId), TICKET_ID);
    assert.ok(Array.isArray(body.related.linkedReports));
  });

  await t.test("404 para tickets con key inexistente", async () => {
    asGerencia();
    const response = await GET(req("/api/explorer/detail?entity=tickets&key=999999999"));
    assert.equal(response.status, 404);
  });

  // El modelo/serie de contrato del equipo canónico se resuelve agregando
  // TODAS las filas físicas que colapsaron en él (source_equipment_keys),
  // nunca solo la primera - la fixture matchea el contrato contra la fila
  // física CON uuid real; la fila física CON uuid vacío también pertenece al
  // mismo equipo canónico y no tiene match propio. Si la agregación fuera un
  // JOIN directo por equipment_key exacto (el bug original), este detalle
  // mostraría "-" en vez del modelo real.
  await t.test("equipment: modelo/serie de contrato se resuelven para el equipo canónico sin importar cuál fila física fue enlazada", async () => {
    asGerencia();
    const canonicalKey = `EXPLORER_TEST_DUP_CLIENT::EXPLORER_TEST_DUP_EQUIP`;
    const response = await GET(req(`/api/explorer/detail?entity=equipment&key=${encodeURIComponent(canonicalKey)}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.summary.source_equipment_keys.sort(), [
      "FIELDBEAT_EQUIPMENT|explorer-test-equip-uuid|EXPLORER_TEST_DUP_EQUIP",
      "FIELDBEAT_EQUIPMENT||explorer_test_dup_equip"
    ].sort(), "las 2 filas físicas duplicadas deben quedar registradas como fuente del equipo canónico");
    assert.deepEqual(body.summary.equipment_models, ["ExplorerTestModel"]);
    assert.deepEqual(body.summary.serial_numbers, ["EXPLORER-TEST-SERIAL"]);
    assert.deepEqual(body.summary.match_statuses, ["MATCHED"]);
  });

  await t.test("clients: la sección Equipos del detalle reutiliza la identidad canónica de Equipos (sin duplicados, con modelo real)", async () => {
    asGerencia();
    const response = await GET(req(`/api/explorer/detail?entity=clients&key=${encodeURIComponent("EXPLORER_TEST_DUP_CLIENT")}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    const equipmentRows = body.related.equipment as Array<{ internal_id: string; equipment_models: string[] | null }>;
    const dupMatches = equipmentRows.filter(row => row.internal_id === "EXPLORER_TEST_DUP_EQUIP");
    assert.equal(dupMatches.length, 1, "el equipo duplicado debe aparecer una sola vez en la sección Equipos del cliente");

    // AMBIG_EQUIP también pertenece a EXPLORER_TEST_DUP_CLIENT (mismo rut A) -
    // confirma que "Contratos y cobertura" trae de verdad el mantenimiento
    // preventivo (no solo el modelo) por cada equipo, no solo en el listado/
    // detalle de Equipos por separado.
    const ambigInEquipment = equipmentRows.find((row: any) => row.internal_id === "EXPLORER_TEST_AMBIG_EQUIP") as any;
    assert.ok(ambigInEquipment, "EXPLORER_TEST_AMBIG_EQUIP debe aparecer en la sección Equipos del cliente");
    const coverage = (body.related.contractsCoverage as any[]).find(row => row.internal_id === "EXPLORER_TEST_AMBIG_EQUIP");
    assert.ok(coverage, "EXPLORER_TEST_AMBIG_EQUIP debe aparecer en Contratos y cobertura (tiene contrato vigente)");
    assert.deepEqual(
      [...coverage.preventive_maintenance_mins].sort(),
      [2, 4],
      "Contratos y cobertura debe traer el mantenimiento preventivo real por equipo, no dejarlo vacío"
    );
    assert.ok(typeof body.summary.contract_equipment_count === "number" && body.summary.contract_equipment_count >= 1);
  });
});
