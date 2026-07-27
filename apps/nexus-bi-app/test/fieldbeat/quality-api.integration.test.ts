// Pruebas de integración de Phase 2 (overview/quality/filters) contra un
// Postgres 16 real y DESECHABLE - mismo mecanismo de seguridad que
// test/after-hours/*.integration.test.ts (ver ese archivo para el contexto
// completo del incidente ETAPA SAFETY-1). Reutiliza las MISMAS variables
// AFTER_HOURS_TEST_DATABASE_URL/AFTER_HOURS_TEST_RUN_ID que esa suite (el
// nombre es histórico - apuntan genéricamente "al Postgres desechable de
// integración", no a nada específico de after-hours; renombrarlas está
// fuera del alcance de Phase 2) - así ambas familias de suites pueden
// coexistir en el mismo Postgres desechable sin bootstrap adicional.
//
// Rango de fieldbeat_task_id propio (900001-900020) y client_key con
// prefijo "QLTYFIX|" - disjunto de los rangos 800001-800009/810001-810009
// de after-hours y de cualquier fieldbeat_task_id real (máximo observado
// en la reconciliación local: 3777).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";
import {
  classifyTeamIdentification,
  type TeamIdentificationCandidate
} from "../../lib/fieldbeat-team-identification.ts";
import { classifyHistoricalPartMatch, type PartAlias } from "../../lib/fieldbeat-parts-history.ts";
import { classifyReportInconsistencies, primaryInconsistency } from "../../lib/fieldbeat-inconsistency-taxonomy.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "fieldbeat-quality-phase2-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_KEY = "QLTYFIX|99.999.999-9|Cliente Fixture Phase2";
const CLIENT_NAME = "Cliente Fixture Phase2";
const ID_MIN = 900001;
const ID_MAX = 900020;

// Cliente/rango DISJUNTO y dedicado (Phase 4) - únicamente para poder
// ejercer paginación real de 2 páginas en /api/dashboard/fieldbeat/reports
// con pageSize=25 (el menor valor del allowlist 25/50/100). Con solo los
// 20 fixtures de CLIENT_NAME nunca se puede probar un segundo LIMIT/OFFSET
// real contra Postgres (20 < 25, siempre 1 página) - y agregar filas a ESE
// cliente rompería las ~15 aserciones de KPI exactas que ya existen sobre
// scoped()/CLIENT_NAME en este archivo. Cliente propio -> cero impacto en
// el resto de la suite.
const PAGINATION_CLIENT_KEY = "QLTYFIX|88.888.888-8|Cliente Fixture Paginacion";
const PAGINATION_CLIENT_NAME = "Cliente Fixture Paginacion";
const PAGINATION_ID_MIN = 901001;
const PAGINATION_ID_MAX = 901026;

function req(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "fieldbeat-quality-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

async function insertTask(row: {
  id: number;
  taskType?: string;
  state: string;
  description?: string | null;
  assignedTo?: string | null;
  startTime?: string | null;
  lastTransitionAt?: string | null;
  durationMinutes?: number | null;
  createdAt?: string;
  createdIn?: string;
  linkedTicketId?: string | null;
  clientKey?: string;
}) {
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_tasks
       (fieldbeat_task_id, client_key, assigned_to, task_type, state, description, start_time, last_transition_at, duration_minutes, created_at, created_in, linked_zendesk_ticket_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      row.id,
      row.clientKey ?? CLIENT_KEY,
      row.assignedTo === undefined ? "fixture_tech" : row.assignedTo,
      row.taskType ?? "PM",
      row.state,
      row.description ?? null,
      row.startTime ?? "2026-03-10T14:00:00Z",
      row.lastTransitionAt ?? "2026-03-10T15:00:00Z",
      row.durationMinutes === undefined ? 45 : row.durationMinutes,
      row.createdAt ?? "2026-03-10T13:00:00Z",
      row.createdIn ?? "APK",
      row.linkedTicketId ?? null
    ]
  );
}

async function insertMartRow(row: {
  id: number;
  taskDate?: string;
  equipmentInternalIds?: string;
  linkedTicketId?: string | null;
  taskType?: string;
  technicianNames?: string;
  clientKey?: string;
  clientName?: string;
}) {
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
       (fieldbeat_task_id, fieldbeat_task_date, client_key, client_name, task_type, task_state, technician_names, equipment_internal_ids, linked_zendesk_ticket_id, used_parts_count, report_quality_status)
     VALUES ($1,$2,$3,$4,$5,'FINISHED',$6,$7,$8,0,'NO_USED_PARTS')`,
    [
      row.id,
      row.taskDate ?? "2026-03-10T14:00:00Z",
      row.clientKey ?? CLIENT_KEY,
      row.clientName ?? CLIENT_NAME,
      row.taskType ?? "PM",
      row.technicianNames === undefined ? "Técnico Fixture" : row.technicianNames,
      row.equipmentInternalIds ?? "",
      row.linkedTicketId ?? null
    ]
  );
}

async function insertPartLine(row: { taskId: number; usedPartId: string; matchStatus: string; rawId?: string; normalizedId?: string }) {
  await adminPool.query(
    `INSERT INTO marts.used_parts_dolibarr_match
       (used_part_id, fieldbeat_task_id, part_name, raw_part_identifier, normalized_part_identifier, match_status)
     VALUES ($1,$2,'Repuesto fixture',$3,$4,$5)`,
    [row.usedPartId, row.taskId, row.rawId ?? row.usedPartId, row.normalizedId ?? row.usedPartId.toLowerCase(), row.matchStatus]
  );
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error("Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).");
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  // Limpieza ACOTADA a este rango/cliente propio - nunca TRUNCATE (ver
  // test/after-hours/weekday-technician-client-api.integration.test.ts:
  // esta base es compartida por varias suites que pueden correr en
  // cualquier orden/paralelismo).
  await adminPool.query(`DELETE FROM marts.used_parts_dolibarr_match WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM marts.ticket_fieldbeat_report_detail WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_equipments WHERE client_key = $1`, [CLIENT_KEY]);
  await adminPool.query(`DELETE FROM manual_review.part_aliases WHERE alias_value LIKE 'QLTYFIX-%'`);

  // Limpieza del rango/cliente dedicado a paginación (Phase 4, ver
  // PAGINATION_CLIENT_KEY más arriba) - mismo principio, disjunto del
  // resto.
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [PAGINATION_ID_MIN, PAGINATION_ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [PAGINATION_ID_MIN, PAGINATION_ID_MAX]);

  await adminPool.query(
    `INSERT INTO processed.fieldbeat_equipments (equipment_key, internal_id, client_key, equipment_type) VALUES
       ('qltyfix-eq-901', 'EQ-901', $1, 'BOMBA'),
       ('qltyfix-eq-902', 'EQ-902', $1, 'BOMBA')`,
    [CLIENT_KEY]
  );

  // 900001: reporte limpio - completo, consistente, sin repuestos, sin ticket.
  await insertTask({ id: 900001, state: "FINISHED", durationMinutes: 45 });
  await insertMartRow({ id: 900001, equipmentInternalIds: "EQ-901" });

  // 900002: sin estructurado, descripción con UN candidato -> TEXT_CONFIDENT_IDENTIFIED.
  await insertTask({ id: 900002, state: "FINISHED", description: "Mantención de EQ-901 programada" });
  await insertMartRow({ id: 900002, equipmentInternalIds: "" });

  // 900003: sin estructurado, descripción con DOS candidatos -> TEXT_AMBIGUOUS.
  await insertTask({ id: 900003, state: "FINISHED", description: "Revisión cruzada EQ-901 y EQ-902 en la misma visita" });
  await insertMartRow({ id: 900003, equipmentInternalIds: "" });

  // 900004: sin estructurado, sin match de texto, SIN técnico -> MISSING + MIN_FIELDS_INCOMPLETE + multipleMissing.
  await insertTask({ id: 900004, state: "FINISHED", description: "Visita general sin equipo identificado", assignedTo: null });
  await insertMartRow({ id: 900004, equipmentInternalIds: "", technicianNames: "" });

  // 900005: cronología imposible (last_transition_at < start_time), duración normal.
  await insertTask({ id: 900005, state: "FINISHED", startTime: "2026-03-10T15:00:00Z", lastTransitionAt: "2026-03-10T14:00:00Z", durationMinutes: 30 });
  await insertMartRow({ id: 900005, equipmentInternalIds: "EQ-901" });

  // 900006: FINISHED con duration_minutes=0 (advertencia distinta de NULL).
  await insertTask({ id: 900006, state: "FINISHED", durationMinutes: 0 });
  await insertMartRow({ id: 900006, equipmentInternalIds: "EQ-901" });

  // 900007: FINISHED con duration_minutes=NULL (advertencia distinta de cero).
  await insertTask({ id: 900007, state: "FINISHED", durationMinutes: null });
  await insertMartRow({ id: 900007, equipmentInternalIds: "EQ-901" });

  // 900008: MÚLTIPLES inconsistencias simultáneas (Alta+Advertencia+Media) - primary debe ser la Alta.
  await insertTask({
    id: 900008,
    state: "FINISHED",
    startTime: "2026-03-10T15:00:00Z",
    lastTransitionAt: "2026-03-10T14:00:00Z",
    durationMinutes: 0,
    assignedTo: null
  });
  await insertMartRow({ id: 900008, equipmentInternalIds: "EQ-901", technicianNames: "" });

  // 900009: DOS códigos Alta simultáneos (PART_AMBIGUOUS_MATCH + TEAM_TEXT_AMBIGUOUS) - desempate estable.
  await insertTask({ id: 900009, state: "FINISHED", description: "Visita con EQ-901 y EQ-902 mencionados" });
  await insertMartRow({ id: 900009, equipmentInternalIds: "" });
  await insertPartLine({ taskId: 900009, usedPartId: "PART-900009-A", matchStatus: "AMBIGUOUS_MATCH" });

  // 900010: ticket informado y ACCESIBLE (bridge presente).
  await insertTask({ id: 900010, state: "FINISHED", linkedTicketId: "500010" });
  await insertMartRow({ id: 900010, equipmentInternalIds: "EQ-901", linkedTicketId: "500010" });
  await adminPool.query(
    `INSERT INTO marts.ticket_fieldbeat_report_detail (bridge_id, zendesk_ticket_id, fieldbeat_task_id, link_method, confidence)
     VALUES ('qltyfix-bridge-10', 500010, 900010, 'exact', 100)`
  );

  // 900011: ticket informado pero SIN fila en el bridge -> missing_or_restricted + TICKET_REPORTED_INACCESSIBLE.
  await insertTask({ id: 900011, state: "FINISHED", linkedTicketId: "500011" });
  await insertMartRow({ id: 900011, equipmentInternalIds: "EQ-901", linkedTicketId: "500011" });

  // 900012: sin ticket informado -> contexto "sin ticket", nunca cuenta en el denominador evaluable.
  await insertTask({ id: 900012, state: "FINISHED", linkedTicketId: null });
  await insertMartRow({ id: 900012, equipmentInternalIds: "EQ-901", linkedTicketId: null });

  // 900013: MÚLTIPLES repuestos, uno MATCHED y uno NO_MATCH -> no fully traceable, PART_NO_MATCH.
  await insertTask({ id: 900013, state: "FINISHED" });
  await insertMartRow({ id: 900013, equipmentInternalIds: "EQ-901" });
  await insertPartLine({ taskId: 900013, usedPartId: "PART-900013-A", matchStatus: "MATCHED" });
  await insertPartLine({ taskId: 900013, usedPartId: "PART-900013-B", matchStatus: "NO_MATCH" });

  // 900014: repuesto NO_MATCH que SÍ resuelve vía alias histórico activo -> HISTORICAL_ALIAS_MATCH, fully traceable.
  await insertTask({ id: 900014, state: "FINISHED" });
  await insertMartRow({ id: 900014, equipmentInternalIds: "EQ-901" });
  await insertPartLine({ taskId: 900014, usedPartId: "PART-900014-A", matchStatus: "NO_MATCH", rawId: "QLTYFIX-HIST-SKU", normalizedId: "qltyfix-hist-sku" });
  await adminPool.query(
    `INSERT INTO manual_review.part_aliases (alias_value, alias_type, dolibarr_product_id, reason, created_by, active)
     VALUES ('QLTYFIX-HIST-SKU', 'RAW', 999901, 'fixture Phase 2', 'integration-test', true)`
  );

  // 900015: repuesto PLACEHOLDER_VALUE aislado -> PART_PLACEHOLDER_ONLY (Baja), no fully traceable.
  await insertTask({ id: 900015, state: "FINISHED" });
  await insertMartRow({ id: 900015, equipmentInternalIds: "EQ-901" });
  await insertPartLine({ taskId: 900015, usedPartId: "PART-900015-A", matchStatus: "PLACEHOLDER_VALUE" });

  // 900016: bridge con 2 filas (2 tickets) para el MISMO reporte -> accessible_ticket_count=2, sin duplicar el reporte.
  await insertTask({ id: 900016, state: "FINISHED", linkedTicketId: "500016" });
  await insertMartRow({ id: 900016, equipmentInternalIds: "EQ-901", linkedTicketId: "500016" });
  await adminPool.query(
    `INSERT INTO marts.ticket_fieldbeat_report_detail (bridge_id, zendesk_ticket_id, fieldbeat_task_id, link_method, confidence) VALUES
       ('qltyfix-bridge-16a', 500016, 900016, 'exact', 100),
       ('qltyfix-bridge-16b', 500017, 900016, 'exact', 90)`
  );

  // 900017/900018: límite de fecha - 23:59:59 del día D (incluido con dateTo=D) vs 00:00:00 del día D+1 (excluido).
  await insertTask({ id: 900017, state: "FINISHED" });
  await insertMartRow({ id: 900017, taskDate: "2026-03-15T23:59:59Z", equipmentInternalIds: "EQ-901" });
  await insertTask({ id: 900018, state: "FINISHED" });
  await insertMartRow({ id: 900018, taskDate: "2026-03-16T00:00:00Z", equipmentInternalIds: "EQ-901" });

  // 900019: taskType distinto, usado para el test de filtro combinado / denominador cero.
  await insertTask({ id: 900019, state: "FINISHED", taskType: "CM" });
  await insertMartRow({ id: 900019, equipmentInternalIds: "EQ-901", taskType: "CM" });

  // 900020: no cerrado (STARTED) - nunca debe contar en KPI1/KPI3 (universo "cerrado").
  await insertTask({ id: 900020, state: "STARTED", assignedTo: null });
  await insertMartRow({ id: 900020, equipmentInternalIds: "" });

  // 901001-901026 (Phase 4): 26 reportes limpios bajo un cliente DISJUNTO
  // (PAGINATION_CLIENT_KEY) - únicamente para ejercer paginación real de 2
  // páginas en /api/dashboard/fieldbeat/reports con pageSize=25. Cliente
  // propio: cero impacto en las aserciones de KPI existentes sobre
  // scoped()/CLIENT_NAME.
  for (let id = PAGINATION_ID_MIN; id <= PAGINATION_ID_MAX; id++) {
    await insertTask({ id, state: "FINISHED", clientKey: PAGINATION_CLIENT_KEY });
    await insertMartRow({ id, equipmentInternalIds: "EQ-901", clientKey: PAGINATION_CLIENT_KEY, clientName: PAGINATION_CLIENT_NAME });
  }
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
  setAuthorizationProviderForTests(null);
});

function scoped(params: Record<string, string> = {}) {
  return { client: CLIENT_NAME, ...params };
}

// === Autorización ===

test("overview: 401 sin sesión", { skip: !TEST_DB_URL }, async () => {
  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const res = await GET(req("/api/dashboard/fieldbeat/overview"));
  assert.equal(res.status, 401);
});

test("overview: 403 con rol no autorizado", { skip: !TEST_DB_URL }, async () => {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "u", app_metadata: { nexus_role: "tecnico" } }, error: null };
    }
  });
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const res = await GET(req("/api/dashboard/fieldbeat/overview"));
  assert.equal(res.status, 403);
});

test("quality: 401 sin sesión, 403 con rol no autorizado, 200 con gerencia", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/quality/route.ts");

  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/quality"))).status, 401);

  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "u", app_metadata: { nexus_role: "tecnico" } }, error: null }; }
  });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/quality"))).status, 403);

  asGerencia();
  assert.equal((await GET(req("/api/dashboard/fieldbeat/quality"))).status, 200);
});

test("overview: 200 con rol administracion (segundo rol de lectura válido)", { skip: !TEST_DB_URL }, async () => {
  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "u2", app_metadata: { nexus_role: "administracion" } }, error: null }; }
  });
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  assert.equal((await GET(req("/api/dashboard/fieldbeat/overview"))).status, 200);
});

// === Validación de parámetros ===

test("overview: 400 con parámetros inválidos, nunca ejecuta la query", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const res = await GET(req("/api/dashboard/fieldbeat/overview", { dateFrom: "no-es-una-fecha", severity: "Critica" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "INVALID_QUERY_PARAMS");
  assert.equal(body.details.length, 2);
});

// === KPI1 - completitud estructural ===

test("KPI1: numerator/denominator/missing* sobre el universo cerrado del fixture (client=Cliente Fixture Phase2)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped()))).json();

  // Cerrados del fixture: 900001-900019 (19 reportes; 900020 es STARTED, no cuenta).
  assert.equal(body.kpi1.denominator, 19);
  // Incompletos: 900003 (equipo TEXT_AMBIGUOUS), 900004 (sin técnico Y sin equipo),
  // 900008 (sin técnico, equipo SÍ estructurado), 900009 (sin estructurado, equipo ambiguo) = 4.
  assert.equal(body.kpi1.numerator, 15);
  assert.equal(body.kpi1.missingTechnician, 2); // 900004, 900008
  assert.equal(body.kpi1.missingClient, 0);
  assert.equal(body.kpi1.missingEquipment, 3); // 900003, 900004, 900009 (TEXT_AMBIGUOUS/MISSING)
  assert.equal(body.kpi1.multipleMissing, 1); // 900004 (técnico Y equipo faltantes a la vez) - 900008 solo falta técnico
  assert.equal(body.kpi1.percentage, Math.round((15 / 19) * 10000) / 100);
});

test("KPI1: denominador cero (filtro que no matchea ningún reporte) -> percentage null, nunca NaN", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped({ taskType: "TIPO_INEXISTENTE" })))).json();
  assert.equal(body.kpi1.denominator, 0);
  assert.equal(body.kpi1.numerator, 0);
  assert.equal(body.kpi1.percentage, null);
});

// === KPI2 - vinculación de tickets, 0..N sin duplicación ===

test("KPI2: accesible/missing_or_restricted/sin_ticket + bridge de 2 filas no duplica el reporte", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped()))).json();

  // Accesibles: 900010 (1 ticket) + 900016 (2 tickets, sigue siendo 1 REPORTE).
  assert.equal(body.kpi2.reportsWithAccessibleTicket, 2);
  assert.equal(body.kpi2.reportsWithMissingOrRestrictedTicket, 1); // 900011
  assert.equal(body.kpi2.evaluableReports, 3);
  const dist2 = body.kpi2.distributionByTicketCount.find((d: { accessibleTicketCount: number }) => d.accessibleTicketCount === 2);
  assert.ok(dist2, "debe existir el bucket accessibleTicketCount=2 (900016)");
  assert.equal(dist2.reportCount, 1, "900016 aparece UNA sola vez pese a tener 2 filas en el bridge");
});

// === KPI3 - identificación de equipos ===

test("KPI3: categorías exhaustivas y la suma cuadra con el denominador", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped()))).json();

  assert.equal(body.kpi3.structured, 15); // todos salvo 900002/900003/900004/900009
  assert.equal(body.kpi3.textConfident, 1); // 900002
  assert.equal(body.kpi3.textAmbiguous, 2); // 900003, 900009
  assert.equal(body.kpi3.missing, 1); // 900004
  assert.equal(body.kpi3.notApplicable, 0);
  assert.equal(body.kpi3.numerator, 16); // structured + textConfident
  assert.equal(body.kpi3.sumMatchesDenominator, true);
  assert.equal(body.kpi3.structured + body.kpi3.textConfident + body.kpi3.textAmbiguous + body.kpi3.missing + body.kpi3.notApplicable, body.kpi3.denominator);
});

// === KPI4 - trazabilidad de repuestos (grano reporte vs grano línea) ===

test("KPI4: MATCHED+NO_MATCH en el mismo reporte no es fully traceable; grano línea nunca se mezcla con grano reporte", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped()))).json();

  // Universo con repuestos: 900009 (1 línea ambigua), 900013 (2 líneas), 900014 (1 línea, alias), 900015 (1 línea placeholder) = 4 reportes.
  assert.equal(body.kpi4.reportGrain.universe, 4);
  assert.equal(body.kpi4.reportGrain.fullyTraceable, 1); // solo 900014 (alias histórico resuelve la única línea)
  assert.equal(body.kpi4.reportGrain.containsNoMatch, 1); // 900013
  assert.equal(body.kpi4.reportGrain.containsAmbiguous, 1); // 900009
  assert.equal(body.kpi4.reportGrain.containsPlaceholder, 1); // 900015
  assert.equal(body.kpi4.reportGrain.combinedProblems, 0); // ninguno acumula 2 categorías de problema a la vez en este fixture

  // Grano línea: total 5 líneas (900009:1, 900013:2, 900014:1, 900015:1).
  assert.equal(body.kpi4.lineGrain.totalLines, 5);
  assert.equal(body.kpi4.lineGrain.directMatches, 1); // 900013 línea MATCHED
  assert.equal(body.kpi4.lineGrain.historicalAliasMatches, 1); // 900014
  assert.equal(body.kpi4.lineGrain.noMatch, 1); // 900013 línea NO_MATCH
  assert.equal(body.kpi4.lineGrain.ambiguous, 1); // 900009
  assert.equal(body.kpi4.lineGrain.placeholders, 1); // 900015
  assert.equal(body.kpi4.historicalAliasLimitation, "Equivalencias históricas disponibles solo cuando existe alias validado");
});

// === KPI5 - consistencia temporal ===

test("KPI5: cronología imposible, duración cero y duración NULL cuentan por separado", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped()))).json();

  assert.equal(body.kpi5.impossibleChronology, 2); // 900005, 900008
  assert.equal(body.kpi5.zeroDurationWarnings, 2); // 900006, 900008
  assert.equal(body.kpi5.nullDurationWarnings, 1); // 900007
  assert.match(body.kpi5.apparentCreationLagDisclaimer, /[Pp]roxy exploratorio/);
});

// === KPI6 - inconsistencias, desempate estable y severidad primaria ===

test("KPI6: reporte con inconsistencias múltiples (Alta+Advertencia+Media) tiene primary=Alta y secundarias contadas", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET: getOverview } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await getOverview(req("/api/dashboard/fieldbeat/overview", scoped()))).json();

  // Afectados en el fixture: 900003,900004,900005,900006,900007,900008,900009,900011,900013,900015 = 10.
  assert.equal(body.kpi6.affectedReports, 10);
  assert.equal(body.kpi6.highSeverityReports >= 3, true, "900005,900008,900009 tienen primary Alta (chronology/ambiguous)");
  assert.equal(body.kpi6.totalSecondaryIssues >= 2, true, "900008 aporta >=2 findings secundarios (zero_duration + min_fields), 900009 aporta 0 extra");
});

test("KPI6: desempate estable - PART_AMBIGUOUS_MATCH gana sobre TEAM_TEXT_AMBIGUOUS cuando ambos son Alta (900009)", { skip: !TEST_DB_URL }, async () => {
  const rows = await adminPool.query(
    `SELECT code, severity FROM quality.fieldbeat_report_primary_inconsistency WHERE fieldbeat_task_id = 900009`
  );
  assert.equal(rows.rows[0].code, "PART_AMBIGUOUS_MATCH");
  assert.equal(rows.rows[0].severity, "Alta");
});

test("KPI6: 900008 tiene primary TEMPORAL_IMPOSSIBLE_CHRONOLOGY pese a tener también Advertencia y Media", { skip: !TEST_DB_URL }, async () => {
  const rows = await adminPool.query(
    `SELECT code FROM quality.fieldbeat_report_primary_inconsistency WHERE fieldbeat_task_id = 900008`
  );
  assert.equal(rows.rows[0].code, "TEMPORAL_IMPOSSIBLE_CHRONOLOGY");
});

// === Filtros combinados y límites de fecha ===

test("filtros combinados: client + taskType estrecha el universo sin romper (900019, taskType=CM)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const res = await GET(req("/api/dashboard/fieldbeat/overview", scoped({ taskType: "CM" })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.kpi1.denominator, 1); // solo 900019
});

test("límite de fecha: dateTo es inclusivo del día completo (900017 23:59:59 incluido, 900018 00:00:00 del día siguiente excluido)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/overview", scoped({ dateFrom: "2026-03-15", dateTo: "2026-03-15" })))
  ).json();
  assert.equal(body.kpi1.denominator, 1, "solo 900017 debe caer dentro de dateTo=2026-03-15 inclusive");
});

// === meta / contrato ===

test("overview: meta incluye generatedAt, contractVersion y filtersApplied", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/overview", scoped({ taskType: "CM" })))).json();
  assert.ok(body.meta.generatedAt);
  assert.equal(body.meta.contractVersion, "2.0.0");
  assert.equal(body.meta.filtersApplied.taskType, "CM");
  assert.equal(body.meta.filtersApplied.client, CLIENT_NAME);
});

test("filters: incluye los nuevos campos aditivos (tecnicos, severities, inconsistencyCodes, ticketStatuses, partStatuses) sin romper el contrato viejo", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/filters/route.ts");
  const body = await (await GET()).json();
  assert.ok(Array.isArray(body.clientes)); // contrato viejo intacto
  assert.ok(Array.isArray(body.tecnicos));
  assert.deepEqual(body.severities, ["Alta", "Media", "Baja", "Advertencia"]);
  assert.ok(body.inconsistencyCodes.includes("TEMPORAL_IMPOSSIBLE_CHRONOLOGY"));
  assert.deepEqual(body.ticketStatuses, ["accessible", "missing_or_restricted", "none"]);
});

// === Equivalencia SQL <-> funciones puras TypeScript ===

test("equivalencia: quality.fieldbeat_team_identification coincide con classifyTeamIdentification() para los fixtures 900001-900004,900009", { skip: !TEST_DB_URL }, async () => {
  const equipmentRows = await adminPool.query<{ internal_id: string }>(
    `SELECT internal_id FROM processed.fieldbeat_equipments WHERE client_key = $1`,
    [CLIENT_KEY]
  );
  const candidates: TeamIdentificationCandidate[] = equipmentRows.rows.map(r => ({ id: r.internal_id }));

  const taskRows = await adminPool.query<{ fieldbeat_task_id: number; description: string | null }>(
    `SELECT fieldbeat_task_id, description FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id IN (900001,900002,900003,900004,900009)`
  );
  const martRows = await adminPool.query<{ fieldbeat_task_id: number; equipment_internal_ids: string }>(
    `SELECT fieldbeat_task_id, equipment_internal_ids FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id IN (900001,900002,900003,900004,900009)`
  );
  const sqlRows = await adminPool.query<{ fieldbeat_task_id: number; team_identification_status: string }>(
    `SELECT fieldbeat_task_id, team_identification_status FROM quality.fieldbeat_team_identification WHERE fieldbeat_task_id IN (900001,900002,900003,900004,900009)`
  );

  const martById = new Map(martRows.rows.map(r => [r.fieldbeat_task_id, r.equipment_internal_ids]));
  const sqlById = new Map(sqlRows.rows.map(r => [r.fieldbeat_task_id, r.team_identification_status]));

  for (const task of taskRows.rows) {
    const structuredIds = (martById.get(task.fieldbeat_task_id) ?? "").split("|").filter(Boolean);
    const tsResult = classifyTeamIdentification({
      structuredEquipmentIds: structuredIds,
      description: task.description,
      candidates
    });
    const sqlStatus = sqlById.get(task.fieldbeat_task_id);
    assert.equal(sqlStatus, tsResult.status, `task ${task.fieldbeat_task_id}: SQL="${sqlStatus}" TS="${tsResult.status}"`);
  }
});

test("equivalencia: quality.fieldbeat_used_part_match coincide con classifyHistoricalPartMatch() para las 5 líneas fixture", { skip: !TEST_DB_URL }, async () => {
  const aliasRows = await adminPool.query<{ alias_value: string; alias_type: "RAW" | "NORMALIZED"; dolibarr_product_id: number; active: boolean }>(
    `SELECT alias_value, alias_type, dolibarr_product_id, active FROM manual_review.part_aliases WHERE alias_value LIKE 'QLTYFIX-%'`
  );
  const activeAliases: PartAlias[] = aliasRows.rows.map(r => ({
    aliasValue: r.alias_value,
    aliasType: r.alias_type,
    dolibarrProductId: r.dolibarr_product_id,
    active: r.active
  }));

  const lineRows = await adminPool.query<{
    used_part_id: string;
    match_status: "MATCHED" | "PLACEHOLDER_VALUE" | "NO_MATCH" | "AMBIGUOUS_MATCH";
    raw_part_identifier: string | null;
    normalized_part_identifier: string | null;
  }>(
    `SELECT used_part_id, match_status, raw_part_identifier, normalized_part_identifier
     FROM marts.used_parts_dolibarr_match
     WHERE fieldbeat_task_id IN (900009, 900013, 900014, 900015)`
  );
  const sqlRows = await adminPool.query<{ used_part_id: string; historical_match_status: string }>(
    `SELECT used_part_id, historical_match_status FROM quality.fieldbeat_used_part_match WHERE fieldbeat_task_id IN (900009, 900013, 900014, 900015)`
  );
  const sqlById = new Map(sqlRows.rows.map(r => [r.used_part_id, r.historical_match_status]));

  assert.equal(lineRows.rows.length, 5, "precondición: deben existir las 5 líneas fixture");
  for (const line of lineRows.rows) {
    const tsResult = classifyHistoricalPartMatch({
      matchStatus: line.match_status,
      rawPartIdentifier: line.raw_part_identifier,
      normalizedPartIdentifier: line.normalized_part_identifier,
      activeAliases
    });
    const sqlStatus = sqlById.get(line.used_part_id);
    assert.equal(sqlStatus, tsResult.status, `línea ${line.used_part_id}: SQL="${sqlStatus}" TS="${tsResult.status}"`);
  }
});

test("equivalencia: primaryInconsistency() en TS coincide con quality.fieldbeat_report_primary_inconsistency para 900005-900009", { skip: !TEST_DB_URL }, async () => {
  const ids = [900005, 900006, 900007, 900008, 900009];
  const rows = await adminPool.query<{
    fieldbeat_task_id: number;
    is_closed: boolean;
    is_finished: boolean;
    chronology_impossible: boolean;
    finished_zero_duration: boolean;
    finished_null_duration: boolean;
    team_identification_status: import("../../lib/fieldbeat-team-identification.ts").TeamIdentificationStatus;
    has_ticket_reported: boolean;
    ticket_accessible: boolean;
    ticket_missing_or_restricted: boolean;
    minimum_fields_complete: boolean;
    part_ambiguous: number;
    part_no_match: number;
    part_placeholders: number;
    part_total_lines: number;
  }>(
    `SELECT fieldbeat_task_id, is_closed, is_finished, chronology_impossible, finished_zero_duration, finished_null_duration,
            team_identification_status, has_ticket_reported, ticket_accessible, ticket_missing_or_restricted,
            minimum_fields_complete, part_ambiguous, part_no_match, part_placeholders, part_total_lines
     FROM quality.fieldbeat_report_quality WHERE fieldbeat_task_id = ANY($1)`,
    [ids]
  );
  const sqlPrimary = await adminPool.query<{ fieldbeat_task_id: number; code: string }>(
    `SELECT fieldbeat_task_id, code FROM quality.fieldbeat_report_primary_inconsistency WHERE fieldbeat_task_id = ANY($1)`,
    [ids]
  );
  const sqlPrimaryById = new Map(sqlPrimary.rows.map(r => [r.fieldbeat_task_id, r.code]));

  for (const r of rows.rows) {
    const partMatchStatuses: string[] = [];
    if (r.part_ambiguous > 0) partMatchStatuses.push("AMBIGUOUS_MATCH");
    if (r.part_no_match > 0) partMatchStatuses.push("NO_MATCH");
    if (r.part_placeholders > 0 && r.part_ambiguous === 0 && r.part_no_match === 0) partMatchStatuses.push("PLACEHOLDER_VALUE");

    const findings = classifyReportInconsistencies({
      isClosed: r.is_closed,
      isFinished: r.is_finished,
      chronologyImpossible: r.chronology_impossible,
      finishedZeroDuration: r.finished_zero_duration,
      finishedNullDuration: r.finished_null_duration,
      teamIdentification: r.team_identification_status,
      hasTicketReported: r.has_ticket_reported,
      ticketAccessible: r.has_ticket_reported ? r.ticket_accessible : null,
      minimumFieldsComplete: r.minimum_fields_complete,
      partMatchStatuses: partMatchStatuses as never[]
    });
    const tsPrimary = primaryInconsistency(findings);
    const sqlCode = sqlPrimaryById.get(r.fieldbeat_task_id) ?? null;
    assert.equal(sqlCode, tsPrimary?.code ?? null, `task ${r.fieldbeat_task_id}: SQL="${sqlCode}" TS="${tsPrimary?.code}"`);
  }
});

// === Phase 3 - GET /api/dashboard/fieldbeat/crossings ===

test("crossings: 401 sin sesión, 403 con rol no autorizado, 400 con type ausente/invalido", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/crossings/route.ts");

  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/crossings", { type: "task_type_missing_field" }))).status, 401);

  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "u", app_metadata: { nexus_role: "tecnico" } }, error: null }; }
  });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/crossings", { type: "task_type_missing_field" }))).status, 403);

  asGerencia();
  assert.equal((await GET(req("/api/dashboard/fieldbeat/crossings"))).status, 400, "sin type es 400");
  assert.equal((await GET(req("/api/dashboard/fieldbeat/crossings", { type: "cliente_x_equipo" }))).status, 400, "type fuera del allowlist es 400");
});

test("crossings: task_type_missing_field refleja los campos faltantes reales del fixture (900004: PM, sin técnico y sin equipo)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/crossings/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/crossings", { type: "task_type_missing_field", client: CLIENT_NAME, taskType: "PM" }))
  ).json();
  assert.equal(body.type, "task_type_missing_field");
  assert.ok(body.rows.includes("PM"));
  assert.ok(body.cols.includes("Técnico"));
  assert.ok(body.cols.includes("Equipo"));
  const cellTecnico = body.cells.find((c: { row: string; col: string }) => c.row === "PM" && c.col === "Técnico");
  const cellEquipo = body.cells.find((c: { row: string; col: string }) => c.row === "PM" && c.col === "Equipo");
  assert.equal(cellTecnico?.count, 2, "900004 y 900008 tienen técnico faltante");
  assert.equal(cellEquipo?.count, 3, "900003, 900004 y 900009 tienen equipo no estructurado/no confiable");
});

test("crossings: technician_completeness reconcilia contra el universo cerrado del fixture (19 reportes)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/crossings/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/crossings", { type: "technician_completeness", client: CLIENT_NAME }))
  ).json();
  const sum = body.cells.reduce((acc: number, c: { count: number }) => acc + c.count, 0);
  assert.equal(sum, 19, "suma de todas las celdas debe reconciliar con el universo cerrado del fixture");
  assert.equal(body.grandTotal, 19);
});

test("crossings: equipment_problem nunca reintroduce el cruce operacional cliente x equipo (columnas son códigos de inconsistencia, no equipos)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/crossings/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/crossings", { type: "equipment_problem", client: CLIENT_NAME }))
  ).json();
  assert.equal(body.colDimensionLabel, "Problema");
  assert.equal(body.rowDimensionLabel, "Equipo");
  for (const col of body.cols) {
    assert.notEqual(col, "EQ-901", "las columnas deben ser códigos de inconsistencia, nunca otro equipo (eso sería el cruce eliminado)");
  }
});

// === Phase 4 - GET /api/dashboard/fieldbeat/reports (bandeja definitiva) ===

test("reports: 401 sin sesión, 403 con rol no autorizado, 400 con filtro inválido", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");

  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/reports"))).status, 401);

  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "u", app_metadata: { nexus_role: "tecnico" } }, error: null }; }
  });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/reports"))).status, 403);

  asGerencia();
  assert.equal((await GET(req("/api/dashboard/fieldbeat/reports", { severity: "Critica" }))).status, 400);
});

test("reports: vista 'exceptions' (default) reconcilia EXACTAMENTE con kpi6.affectedReports bajo el mismo filtro", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET: getOverview } = await import("../../app/api/dashboard/fieldbeat/overview/route.ts");
  const { GET: getReports } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");

  const overviewBody = await (await getOverview(req("/api/dashboard/fieldbeat/overview", scoped()))).json();
  const reportsBody = await (await getReports(req("/api/dashboard/fieldbeat/reports", scoped()))).json();

  assert.equal(reportsBody.view, "exceptions", "exceptions es la vista default cuando no se pide reportsView");
  assert.equal(reportsBody.totalRows, overviewBody.kpi6.affectedReports, "misma base SQL: universe + primary_inconsistency IS NOT NULL");
  assert.equal(reportsBody.totalRows, 10);
  for (const row of reportsBody.rows) {
    assert.ok(row.primary, `fila ${row.fieldbeatTaskId} en 'exceptions' debe tener primary no-null`);
  }
});

test("reports: vista 'all' incluye reportes limpios (primary=null) - universo completo del filtro, no solo cerrados", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports", scoped({ reportsView: "all", pageSize: "100" })))).json();

  // universe no restringe por is_closed - los 20 fixtures (900001-900020) matchean client=CLIENT_NAME.
  assert.equal(body.totalRows, 20);
  const clean = body.rows.find((r: { fieldbeatTaskId: string }) => r.fieldbeatTaskId === "900001");
  assert.ok(clean, "900001 (reporte limpio) debe aparecer en 'all'");
  assert.equal(clean.primary, null);
});

test("reports: paginación real - pageSize=25 (el menor del allowlist) produce 2 páginas sobre 'all' (26 filas del fixture de paginación), hasNext/hasPrevious correctos", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const page1 = await (
    await GET(req("/api/dashboard/fieldbeat/reports", { client: PAGINATION_CLIENT_NAME, reportsView: "all", pageSize: "25", page: "1" }))
  ).json();
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.rows.length, 25);
  assert.equal(page1.hasPrevious, false);
  assert.equal(page1.hasNext, true);
  assert.equal(page1.effectiveRangeFrom, 1);
  assert.equal(page1.effectiveRangeTo, 25);

  const page2 = await (
    await GET(req("/api/dashboard/fieldbeat/reports", { client: PAGINATION_CLIENT_NAME, reportsView: "all", pageSize: "25", page: "2" }))
  ).json();
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.hasNext, false);
  assert.equal(page2.hasPrevious, true);
  assert.equal(page2.effectiveRangeFrom, 26);
  assert.equal(page2.effectiveRangeTo, 26);
});

test("reports: page fuera de rango se autocorrige a página 1, nunca reporta totalRows=0 por error", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/reports", { client: PAGINATION_CLIENT_NAME, reportsView: "all", pageSize: "25", page: "999" }))
  ).json();
  assert.equal(body.totalRows, 26, "el total real debe seguir siendo 26, no 0 (COUNT(*) OVER() se pierde si el OFFSET no devuelve filas)");
  assert.equal(body.page, 1, "se autocorrige a página 1 (reintento barato, sin una 2da consulta para calcular la última página real)");
  assert.equal(body.rows.length, 25);
});

test("reports: búsqueda por ID exacta-o-prefijo", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");

  const exact = await (await GET(req("/api/dashboard/fieldbeat/reports", scoped({ reportsView: "all", search: "900005" })))).json();
  assert.equal(exact.totalRows, 1);
  assert.equal(exact.rows[0].fieldbeatTaskId, "900005");

  const prefix = await (await GET(req("/api/dashboard/fieldbeat/reports", scoped({ reportsView: "all", search: "90000" })))).json();
  assert.equal(prefix.totalRows, 9, "90000 es prefijo de 900001-900009 únicamente");
});

test("reports: sort=severity desc trae un reporte de severidad Alta primero", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/reports", scoped({ reportsView: "all", sort: "severity", direction: "desc" })))
  ).json();
  assert.equal(body.rows[0].primary.severity, "Alta");
});

// === Phase 5 preflight §2.2 - metadata correcta cuando la consulta devuelve 0 filas ===
// COUNT(*) OVER() viaja EN cada fila devuelta - si la página 1 (offset 0) ya
// devuelve 0 filas, eso es inequívoco: el total real es 0 (no hay forma de
// que exista una fila más adelante que la página 1 no haya visto). Distinto
// del caso "page fuera de rango con total>0" (ya cubierto arriba), donde SÍ
// hace falta el reintento en página 1 para recuperar el total real.
const RESPONSE_SHAPE_KEYS = ["rows", "view", "page", "pageSize", "totalRows", "totalPages", "hasNext", "hasPrevious", "effectiveRangeFrom", "effectiveRangeTo", "sort", "direction", "search"];

function assertZeroRowShape(body: Record<string, unknown>) {
  for (const key of RESPONSE_SHAPE_KEYS) assert.ok(key in body, `falta la clave "${key}" en la respuesta`);
  assert.deepEqual(body.rows, []);
  assert.equal(body.totalRows, 0);
  assert.equal(body.totalPages, 1, "1 página nominal, nunca 0 páginas");
  assert.equal(body.page, 1);
  assert.equal(body.hasNext, false);
  assert.equal(body.hasPrevious, false);
  assert.equal(body.effectiveRangeFrom, 0);
  assert.equal(body.effectiveRangeTo, 0);
}

test("reports §2.2 (1/5): filtro sin resultados (client inexistente) - metadata completa y coherente en 0 filas", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports", { reportsView: "all", client: "CLIENTE_QUE_NO_EXISTE_XYZ" }))).json();
  assertZeroRowShape(body);
});

test("reports §2.2 (2/5): página solicitada mayor que totalPages sobre un universo NO vacío - se autocorrige, total real preservado", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/reports", { client: PAGINATION_CLIENT_NAME, reportsView: "all", pageSize: "25", page: "50" }))
  ).json();
  assert.equal(body.totalRows, 26, "el total real (26) nunca se reporta como 0 solo porque el offset solicitado cae fuera de rango");
  assert.equal(body.page, 1);
  assert.equal(body.rows.length, 25);
});

test("reports §2.2 (3/5): universo vacío (filtro combinado imposible) - misma forma de respuesta que cualquier otro caso vacío", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (
    await GET(req("/api/dashboard/fieldbeat/reports", scoped({ reportsView: "all", taskType: "TIPO_QUE_NO_EXISTE" })))
  ).json();
  assertZeroRowShape(body);
});

test("reports §2.2 (4/5): búsqueda de ID inexistente - 0 filas, metadata completa, nunca un error", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports", { reportsView: "all", search: "999999999" }))).json();
  assertZeroRowShape(body);
});

test("reports §2.2 (5/5): última página deja de existir tras angostar el filtro (page=2 con pageSize=25 sobre un universo que ahora cabe en 1 página)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");
  // 20 fixtures de CLIENT_NAME con reportsView=all -> 1 sola página con pageSize=25;
  // pedir page=2 simula el caso "yo estaba en la página 2 y un cambio de filtro
  // la hizo desaparecer".
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports", scoped({ reportsView: "all", pageSize: "25", page: "2" })))).json();
  assert.equal(body.totalRows, 20);
  assert.equal(body.page, 1, "se autocorrige a la única página real");
  assert.equal(body.totalPages, 1);
  assert.equal(body.hasNext, false);
  assert.equal(body.hasPrevious, false);
});

test("reports: CSV export respeta el filtro/vista vigente, escapa fórmulas y no pagina", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/export/route.ts");
  const res = await GET(req("/api/dashboard/fieldbeat/reports/export", scoped({ reportsView: "all" })));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(res.headers.get("Content-Disposition") ?? "", /attachment; filename="fieldbeat-reportes-all-\d{4}-\d{2}-\d{2}\.csv"/);

  const text = await res.text();
  const lines = text.trim().split("\r\n");
  // HOTFIX de integridad de datos FieldBeat (Stage 10) - tecnicos_adicionales
  // es aditivo, nunca reemplaza a "tecnico" (responsable principal).
  assert.equal(
    lines[0],
    "id_reporte,fecha,cliente,tecnico,tecnicos_adicionales,equipo,tipo_tarea,origen,estado_calidad,severidad_principal,codigo_principal,hallazgos_secundarios,ticket_informado,ticket_accesible"
  );
  // 20 fixtures + 1 header.
  assert.equal(lines.length, 21);
});

// === Phase 5 - GET /api/dashboard/fieldbeat/reports/[id] (detalle maestro) ===

function detailReq(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("detalle: 401 sin sesión, 403 con rol no autorizado, 400 con ID inválido (decimal/negativo/cero/texto)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");

  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/reports/900001"), detailReq("900001"))).status, 401);

  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "u", app_metadata: { nexus_role: "tecnico" } }, error: null }; }
  });
  assert.equal((await GET(req("/api/dashboard/fieldbeat/reports/900001"), detailReq("900001"))).status, 403);

  asGerencia();
  for (const badId of ["0", "-1", "1.5", "abc", "900005e1", "01"]) {
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${badId}`), detailReq(badId));
    assert.equal(res.status, 400, `ID "${badId}" debería ser 400`);
  }
});

test("detalle: 404 para un ID bien formado pero inexistente, nunca 500", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const res = await GET(req("/api/dashboard/fieldbeat/reports/999999999"), detailReq("999999999"));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, "NOT_FOUND");
});

test("detalle: reporte limpio (900001) - technician/client presentes, colecciones vacías (nunca null)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900001"), detailReq("900001"))).json();

  assert.equal(body.report.fieldbeatTaskId, "900001");
  assert.equal(body.report.isClosed, true);
  assert.equal(body.technician?.name, "Técnico Fixture", "technician_names en quality.fieldbeat_report_quality viene de la fila mart, no de processed.fieldbeat_tasks.assigned_to");
  assert.equal(body.client?.clientName, CLIENT_NAME);
  assert.equal(body.equipment.status, "STRUCTURED_IDENTIFIED");
  assert.deepEqual(body.equipment.items, [{ internalId: "EQ-901", source: "STRUCTURED", confirmed: true }]);
  assert.deepEqual(body.tickets, []);
  assert.deepEqual(body.parts, []);
  assert.deepEqual(body.inconsistencies, []);
  assert.equal(body.quality.totalInconsistencies, 0);
  assert.ok(body.contractVersion);
});

test("detalle: reporte no cerrado (900020, STARTED) - isClosed=false, sigue devolviendo un detalle completo", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900020"), detailReq("900020"))).json();
  assert.equal(body.report.state, "STARTED");
  assert.equal(body.report.isClosed, false);
  assert.equal(body.equipment.status, "MISSING", "900020 no tiene equipo estructurado ni recuperable de texto");
});

test("detalle: múltiples tickets (900016, bridge con 2 filas) - 0..N sin colapsar al primero", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900016"), detailReq("900016"))).json();
  assert.equal(body.tickets.length, 2);
  const ids = body.tickets.map((t: { zendeskTicketId: string }) => t.zendeskTicketId).sort();
  assert.deepEqual(ids, ["500016", "500017"]);
});

test("detalle: ticket informado pero inaccesible (900011) - se distingue de 'sin ticket', nunca tratado como error", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900011"), detailReq("900011"))).json();
  assert.equal(body.quality.ticketMissingOrRestricted, true);
  assert.equal(body.quality.ticketAccessible, false);
});

// HOTFIX de integridad de datos FieldBeat (§ contrato 2.0.0) -
// historicalMatchStatus -> catalogMatchStatus, dolibarrProduct/
// ambiguousCandidateProductIds/historicalAlias -> matchEvidence discriminado
// (ver types/fieldbeat-report-detail.ts, lib/fieldbeat-part-occurrence.ts).
test("detalle: múltiples líneas de repuesto (900013: MATCHED + NO_MATCH) - grano línea, sin duplicar por el join de tickets/equipos", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900013"), detailReq("900013"))).json();
  assert.equal(body.parts.length, 2);
  const statuses = body.parts.map((p: { catalogMatchStatus: string }) => p.catalogMatchStatus).sort();
  assert.deepEqual(statuses, ["CURRENT_DIRECT_MATCH", "NO_MATCH"]);
});

test("detalle: alias histórico (900014) - se muestra SOLO porque existe fila real en manual_review.part_aliases", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900014"), detailReq("900014"))).json();
  assert.equal(body.parts.length, 1);
  assert.equal(body.parts[0].catalogMatchStatus, "HISTORICAL_ALIAS_MATCH");
  assert.equal(body.parts[0].matchEvidence?.kind, "HISTORICAL_ALIAS");
  assert.equal(body.parts[0].matchEvidence?.aliasValue, "QLTYFIX-HIST-SKU");
});

test("detalle: repuesto ambiguo (900009) - catalogMatchStatus=AMBIGUOUS_MATCH, nunca promovido a matchedProductId confirmado", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900009"), detailReq("900009"))).json();
  assert.equal(body.parts.length, 1);
  assert.equal(body.parts[0].catalogMatchStatus, "AMBIGUOUS_MATCH");
  assert.equal(body.parts[0].matchedProductId, null);
});

test("detalle: inconsistencia principal (900008) coincide con quality.fieldbeat_report_primary_inconsistency, orden severidad->priority_order", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900008"), detailReq("900008"))).json();
  assert.ok(body.inconsistencies.length >= 2, "900008 dispara varios códigos simultáneos");
  const primaryEntries = body.inconsistencies.filter((f: { isPrimary: boolean }) => f.isPrimary);
  assert.equal(primaryEntries.length, 1, "exactamente 1 inconsistencia marcada como principal");
  assert.equal(primaryEntries[0].code, "TEMPORAL_IMPOSSIBLE_CHRONOLOGY");
  assert.ok(primaryEntries[0].explanation.length > 0);
  assert.ok(primaryEntries[0].suggestedAction.length > 0);
  // Orden: severidad (Alta antes que Media/Advertencia) primero.
  const severityRank: Record<string, number> = { Alta: 0, Media: 1, Baja: 2, Advertencia: 3 };
  for (let i = 1; i < body.inconsistencies.length; i++) {
    assert.ok(severityRank[body.inconsistencies[i - 1].severity] <= severityRank[body.inconsistencies[i].severity], "orden de severidad violado");
  }
});

test("detalle: identificación de equipo ambigua (900003) - candidatos listados, NINGUNO confirmed (nunca se promueve una ambigüedad a match)", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900003"), detailReq("900003"))).json();
  assert.equal(body.equipment.status, "TEXT_AMBIGUOUS");
  assert.ok(body.equipment.items.length >= 2);
  for (const item of body.equipment.items) {
    assert.equal(item.confirmed, false);
    assert.equal(item.source, "TEXT_AMBIGUOUS_CANDIDATE");
  }
});

test("detalle: equipo ausente (900004) - equipment.items vacío, nunca un equipo inventado", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/route.ts");
  const body = await (await GET(req("/api/dashboard/fieldbeat/reports/900004"), detailReq("900004"))).json();
  assert.equal(body.equipment.status, "MISSING");
  assert.deepEqual(body.equipment.items, []);
});
