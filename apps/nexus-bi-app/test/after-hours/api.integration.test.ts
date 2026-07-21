// Pruebas de integración contra un Postgres 16 real y DESECHABLE, aislado
// del contenedor de contracts/holidays/working-hours (ETAPA 6.6C §15). Se
// saltan enteras si AFTER_HOURS_TEST_DATABASE_URL no está seteada. Llaman
// los handlers GET(...) reales de cada route.ts (mismo código que Next.js
// invocaría), nunca reimplementan la lógica.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

// ETAPA SAFETY-1 - ver test/working-hours/ddl.integration.test.js (repo
// root) para el contexto completo del incidente que motivó este guard.
const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "after-hours-api-test";
setAuthorizationProviderForTests({
  async getUser() {
    return { user: { id: "after-hours-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
  }
});
// ETAPA 6.6D-V - este archivo siempre apunta a un Postgres local desechable
// (nunca a un host remoto, por diseño del propio guard SAFETY-1 de arriba)
// -DATABASE_SSL_MODE=disable es válido y necesario acá para que las rutas
// bajo prueba (vía lib/db.ts::getPool) no fuercen un handshake SSL contra
// un Postgres desechable recién creado, que no trae SSL habilitado por
// defecto. Ver lib/db.ts para el contrato completo.
if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;
let builderRunId: string;

function req(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error(`Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).`);
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  const runRes = await adminPool.query(`INSERT INTO audit.pipeline_runs (stage, status) VALUES ('after-hours-api-test', 'SUCCESS') RETURNING run_id`);
  builderRunId = runRes.rows[0].run_id;

  // Limpieza + processed.fieldbeat_tasks (la vista parte de acá, LEFT JOIN).
  await adminPool.query(`TRUNCATE marts.fieldbeat_working_hours_equipment_links, marts.fieldbeat_working_hours_analysis_v2, marts.fieldbeat_working_hours_analysis RESTART IDENTITY CASCADE`);
  // Limpia ambos rangos reservados por las suites after-hours. El runner
  // ejecuta este archivo primero, así que esto hace repetible la cadena
  // completa aun cuando una corrida anterior haya dejado 810001-810009.
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN 800001 AND 810009`);
  for (const [id, client, tech, taskType] of [
    [800001, "Cliente Contractual", "tech1", "PM"],
    [800002, "Cliente Legacy", "tech2", "CM"],
    [800003, "Cliente NoneTerminal", "tech1", "PM"],
    [800004, "Cliente NoneResolved", "tech2", "CM"],
    [800005, "Cliente LegacyMartFallback", "tech1", "PM"]
  ] as const) {
    await adminPool.query(
      `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, client_key, assigned_to, task_type, start_time, duration_minutes) VALUES ($1,$2,$3,$4,'2026-08-10T20:00:00Z',60)`,
      [id, client, tech, taskType]
    );
  }

  // Fixture 1: CONTRACTUAL, parcialmente cubierta, 1 equipo primario.
  const c1 = await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, confidence_factors, calculation_method,
        contract_resolution_confidence, contract_resolution_label,
        data_basis, builder_run_id)
     VALUES (800001,'CLI-1','Cliente Contractual','PM','tech1',
        '2026-08-10T20:00:00Z','2026-08-10T16:00:00','2026-08-10T21:00:00Z','2026-08-10T17:00:00',3600,
        1800,1800,1800,0,0,
        1800,0.5,true,
        'CALCULATED','PARTIALLY_COVERED','WITHIN_MATCHED_CONTRACT',
        'CALCULATED','PARTIALLY_COVERED','WITHIN_MATCHED_CONTRACT',false,
        90,'Alta','factores de prueba','ESTIMATED_FROM_START_DURATION',
        90,'Alta',
        'CONTRACTUAL',$1)
     RETURNING working_hours_id`,
    [builderRunId]
  );
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_equipment_links
       (working_hours_id, fieldbeat_equipment_key, match_status, equipment_coverage_classification, equipment_reason_code, coverage_fingerprint, is_primary)
     VALUES ($1,'FIELDBEAT_EQUIPMENT|test|EQ-1','MATCHED','PARTIALLY_COVERED','WITHIN_MATCHED_CONTRACT','fp-1',true)`,
    [c1.rows[0].working_hours_id]
  );

  // Fixture 2: LEGACY_SCHEDULE con fallback real (contrato falló por EQUIPMENT_UNMATCHED).
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, confidence_factors, calculation_method,
        data_basis, builder_run_id)
     VALUES (800002,'CLI-2','Cliente Legacy','CM','tech2',
        '2026-08-10T20:00:00Z','2026-08-10T16:00:00','2026-08-10T21:00:00Z','2026-08-10T17:00:00',3600,
        3600,0,0,0,0,
        0,0,false,
        'CALCULATED','FULLY_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        70,'Media','factores de prueba','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );

  // Fixture 3: NONE terminal (intervalo nunca resuelto, INSUFFICIENT_DATA).
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        calculation_method, data_basis, builder_run_id)
     VALUES (800003,'CLI-3','Cliente NoneTerminal','PM','tech1',
        'NOT_CALCULABLE','NOT_CALCULABLE','INSUFFICIENT_DATA',
        'NOT_CALCULABLE','NOT_CALCULABLE','INSUFFICIENT_DATA',false,
        'INSUFFICIENT_DATA','NONE',$1)`,
    [builderRunId]
  );

  // Fixture 4: NONE con intervalo SÍ resuelto (ambos intentos de cobertura
  // fallaron) - duration_seconds/confidence_score NO nulos, cobertura sí.
  // Este es el caso que sumMinutesExpr/confidenceWeightedExpr deben excluir
  // explícitamente pese a tener minutos/score no nulos.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (800004,'CLI-4','Cliente NoneResolved','CM','tech2',
        '2026-08-10T20:00:00Z','2026-08-10T16:00:00','2026-08-10T21:00:00Z','2026-08-10T17:00:00',3600,
        'NOT_CALCULABLE','NOT_CALCULABLE','NO_EQUIPMENT',
        'NOT_CALCULABLE','NOT_CALCULABLE','NO_EQUIPMENT',false,
        60,'Baja','ESTIMATED_FROM_START_DURATION',
        'NONE',$1)`,
    [builderRunId]
  );

  // Fixture 5: solo mart legado (sin fila en Capa C) - la vista rellena vía
  // LEFT JOIN l.* -> data_basis='LEGACY_SCHEDULE'. duration_minutes no
  // nulo, confidence_score SÍ nulo: caso real que motivó el fix de §6.2.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, duration_minutes,
        business_minutes, after_hours_weekday_minutes, weekend_minutes, holiday_minutes, after_hours_total_minutes,
        after_hours_rate, is_after_hours_task, calculation_method, calculation_status,
        confidence_score, confidence_label)
     VALUES (800005,'CLI-5','Cliente LegacyMartFallback','PM','tech1',
        '2026-08-10T20:00:00Z','2026-08-10T16:00:00',120,
        100,20,0,0,20,
        0.1667,true,'ESTIMATED_FROM_START_DURATION','CALCULATED',
        NULL,NULL)`
  );
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("summary: poblaciones separan CONTRACTUAL/LEGACY_SCHEDULE/NONE correctamente, NONE nunca es 0", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary"));
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.total_tasks, 5);
  assert.equal(body.contractual_tasks, 1);
  // legacy_schedule_tasks cuenta task 800002 (Capa C) + 800005 (relleno del mart legado) = 2.
  assert.equal(body.legacy_schedule_tasks, 2);
  assert.equal(body.none_tasks, 2);
  assert.equal(body.calculable_tasks, 3);
  assert.equal(body.fallback_tasks, 1); // solo 800002 tiene fallback_used=true real (800005 no tiene columna fallback_used, viene del mart legado)
});

test("summary: totalHours/businessHours excluyen la tarea NONE con duration_seconds no nulo (800004)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary"));
  const body = await res.json();
  // Solo 800001 (60min) + 800002 (60min) + 800005 (120min) = 240 min = 4h calculables.
  // 800003/800004 (NONE) nunca contribuyen, aunque 800004 tenga duration_seconds no nulo.
  assert.equal(body.kpis.totalHours.value, 4);
});

test("summary: confidence_eligible_tasks/confidence_excluded_tasks reflejan el caso NULL-safe real (800005 excluida)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary"));
  const body = await res.json();
  // Elegibles: 800001, 800002 (confidence+duration no nulos). Excluida: 800005 (confidence NULL, calculable).
  assert.equal(body.confidence_eligible_tasks, 2);
  assert.equal(body.confidence_excluded_tasks, 1);
});

test("summary: blank_status_count fue retirado (no aparece en la respuesta)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary"));
  const body = await res.json();
  assert.equal("blank_status_count" in body, false);
  assert.equal("blank_status_count" in body.kpis.tasksNotCalculable, false);
});

test("summary: byDataBasis documenta el multi-fuente de business_minutes (§6.1)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary"));
  const body = await res.json();
  const byBasis = new Map(body.byDataBasis.map((r: { data_basis: string; task_count: number }) => [r.data_basis, r.task_count]));
  assert.equal(byBasis.get("CONTRACTUAL"), 1);
  assert.equal(byBasis.get("LEGACY_SCHEDULE"), 2);
  assert.equal(byBasis.get("NONE"), 2);
});

test("summary: filtro dataBasis=CONTRACTUAL acota correctamente", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary", { dataBasis: "CONTRACTUAL" }));
  const body = await res.json();
  assert.equal(body.total_tasks, 1);
  assert.equal(body.contractual_tasks, 1);
});

// ETAPA 6.6D-FIX-1 - distinct_technicians/distinct_clients: universo
// FILTRADO real (COUNT DISTINCT NULLIF(BTRIM(...),'')), nunca el catálogo
// global de filterOptions.tecnicos/clientes.length (bug original: quedaban
// fijos en 19/26 sin importar el filtro de fecha). Fixture: tech1 aparece
// en 800001/800003/800005 (3 clientes distintos), tech2 en 800002/800004 (2
// tareas, comparten... en realidad cada task_id tiene su propio
// client_name distinto - ver seed arriba) -> sin filtros: 2 técnicos, 5 clientes.
test("summary: distinct_technicians/distinct_clients sin filtros reflejan el universo real (2 técnicos, 5 clientes)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary"));
  const body = await res.json();
  assert.equal(body.distinct_technicians, 2);
  assert.equal(body.distinct_clients, 5);
});

test("summary: distinct_technicians/distinct_clients con rango de fechas sin tareas -> ambos 0 (nunca el catálogo global)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary", { from: "2026-09-01", to: "2026-09-30" }));
  const body = await res.json();
  assert.equal(body.total_tasks, 0);
  assert.equal(body.distinct_technicians, 0);
  assert.equal(body.distinct_clients, 0);
});

test("summary: distinct_technicians/distinct_clients con technician=tech1 -> 1 técnico, 3 clientes (universo acotado por tech1)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary", { technician: "tech1" }));
  const body = await res.json();
  assert.equal(body.distinct_technicians, 1);
  assert.equal(body.distinct_clients, 3); // Cliente Contractual, Cliente NoneTerminal, Cliente LegacyMartFallback
});

test("summary: distinct_technicians/distinct_clients con client=Cliente Legacy -> 1 cliente, 1 técnico (tech2)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/summary", { client: "Cliente Legacy" }));
  const body = await res.json();
  assert.equal(body.distinct_clients, 1);
  assert.equal(body.distinct_technicians, 1);
});

test("by-technician: rango de fechas sin tareas -> rows.length = 0 (el filtro de fecha SÍ se aplica, no solo la autoexclusión)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-technician/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-technician", { from: "2026-09-01", to: "2026-09-30" }));
  const body = await res.json();
  assert.equal(body.rows.length, 0);
});

test("by-client: rango de fechas sin tareas -> rows.length = 0 (el filtro de fecha SÍ se aplica, no solo la autoexclusión)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-client/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-client", { from: "2026-09-01", to: "2026-09-30" }));
  const body = await res.json();
  assert.equal(body.rows.length, 0);
});

test("by-technician: rango de fechas CON tareas + technician=tech1 activo -> autoexclusión conserva tech2, pero fecha sigue acotando", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-technician/route.ts");
  const withData = await GET(req("/api/dashboard/after-hours/by-technician", { from: "2026-08-01", to: "2026-08-31", technician: "tech1" }));
  const bodyWithData = await withData.json();
  assert.equal(bodyWithData.rows.length, 2); // tech1 Y tech2 (autoexclusión), ambos con tareas en agosto

  const withoutData = await GET(req("/api/dashboard/after-hours/by-technician", { from: "2026-09-01", to: "2026-09-30", technician: "tech1" }));
  const bodyWithoutData = await withoutData.json();
  assert.equal(bodyWithoutData.rows.length, 0); // ninguno tiene tareas en septiembre, autoexclusión no "rescata" la fecha
});

test("by-client: agrupa correctamente, tasa SUM/SUM (no promedio por fila)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-client/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-client"));
  const body = await res.json();
  assert.equal(body.rows.length, 5); // 5 fixtures, 5 client_name distintos
  const contractual = body.rows.find((r: { key: string }) => r.key === "Cliente Contractual");
  assert.equal(contractual.after_hours_rate, 0.5);
  assert.equal(contractual.contractual_tasks, 1);
});

test("by-period: agrupa por mes de start_time_local, fila NONE terminal (sin intervalo) cae en '(sin fecha)'", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-period/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-period"));
  const body = await res.json();
  // 800001/800002/800004/800005 tienen start_time_local -> "2026-08".
  // 800003 (NONE terminal, intervalo nunca resuelto) -> "(sin fecha)".
  assert.equal(body.rows.length, 2);
  const withDate = body.rows.find((r: { key: string }) => r.key === "2026-08");
  const withoutDate = body.rows.find((r: { key: string }) => r.key === "(sin fecha)");
  assert.equal(withDate.total_tasks, 4);
  assert.equal(withoutDate.total_tasks, 1);
});

test("by-task-type y by-technician: no duplican tareas (conteo total = 5 sumado sobre grupos)", { skip: !TEST_DB_URL }, async () => {
  const { GET: getByTaskType } = await import("../../app/api/dashboard/after-hours/by-task-type/route.ts");
  const { GET: getByTechnician } = await import("../../app/api/dashboard/after-hours/by-technician/route.ts");
  const taskTypeBody = await (await getByTaskType(req("/api/dashboard/after-hours/by-task-type"))).json();
  const technicianBody = await (await getByTechnician(req("/api/dashboard/after-hours/by-technician"))).json();
  assert.equal(
    taskTypeBody.rows.reduce((acc: number, r: { total_tasks: number }) => acc + r.total_tasks, 0),
    5
  );
  assert.equal(
    technicianBody.rows.reduce((acc: number, r: { total_tasks: number }) => acc + r.total_tasks, 0),
    5
  );
});

test("confidence-distribution: 4 tiers fijos, NONE sin score reportado aparte (nunca como Insuficiente)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/confidence-distribution/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/confidence-distribution"));
  const body = await res.json();
  assert.equal(body.rows.length, 4);
  assert.deepEqual(
    body.rows.map((r: { confidence_label: string }) => r.confidence_label),
    ["Insuficiente", "Baja", "Media", "Alta"]
  );
  // 800003 (NONE terminal, confidence_label NULL) es la única sin score.
  assert.equal(body.noneWithoutScore, 1);
  // 800004 SÍ tiene confidence_label='Baja' pese a ser NONE -cuenta en el tier, correcto (no es "sin score").
  const baja = body.rows.find((r: { confidence_label: string }) => r.confidence_label === "Baja");
  assert.equal(baja.task_count, 1);
});

test("confidence-distribution: contractResolutionDistribution es exclusiva de CONTRACTUAL, escala separada", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/confidence-distribution/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/confidence-distribution"));
  const body = await res.json();
  assert.equal(body.contractResolutionDistribution.length, 1);
  assert.equal(body.contractResolutionDistribution[0].contract_resolution_label, "Alta");
  assert.equal(body.contractResolutionDistribution[0].task_count, 1);
});

test("detail: expone campos contractuales aditivos y nunca oculta el motivo cuando fallback_used=true", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/detail/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/detail", { pageSize: "20" }));
  const body = await res.json();
  const legacyRow = body.rows.find((r: { fieldbeat_task_id: number }) => r.fieldbeat_task_id === 800002);
  assert.equal(legacyRow.data_basis, "LEGACY_SCHEDULE");
  assert.equal(legacyRow.fallback_used, true);
  assert.equal(legacyRow.contractual_reason_code, "EQUIPMENT_UNMATCHED");
});

test("detail: data_basis=NONE nunca inventa 0 - minutos NULL, intervalo conservado si el reason no es terminal", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/detail/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/detail", { pageSize: "20" }));
  const body = await res.json();

  const terminalRow = body.rows.find((r: { fieldbeat_task_id: number }) => r.fieldbeat_task_id === 800003);
  assert.equal(terminalRow.start_time, null);
  assert.equal(terminalRow.duration_hours, null);

  const resolvedNoneRow = body.rows.find((r: { fieldbeat_task_id: number }) => r.fieldbeat_task_id === 800004);
  assert.notEqual(resolvedNoneRow.start_time, null, "intervalo se conserva pese a NONE, motivo no terminal");
  assert.equal(resolvedNoneRow.business_hours, null, "minutos de cobertura siguen NULL, nunca 0 inventado");
  assert.equal(resolvedNoneRow.coverage_reason_code, "NO_EQUIPMENT");
});

test("detail: paginación funciona (pageSize=2 produce 3 páginas para 5 filas)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/detail/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/detail", { pageSize: "2", page: "1" }));
  const body = await res.json();
  assert.equal(body.rows.length, 2);
  assert.equal(body.totalRows, 5);
  assert.equal(body.totalPages, 3);
});

test("detail: ordenamiento vía allowlist (sortBy=confidence_score) no permite inyectar una columna arbitraria", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/detail/route.ts");
  const resValid = await GET(req("/api/dashboard/after-hours/detail", { sortBy: "confidence_score", sortDir: "asc", pageSize: "20" }));
  assert.equal(resValid.status, 200);

  const resInjection = await GET(req("/api/dashboard/after-hours/detail", { sortBy: "fieldbeat_task_id; DROP TABLE marts.fieldbeat_working_hours_analysis_v2;--", pageSize: "20" }));
  assert.equal(resInjection.status, 200, "una columna no permitida cae al default (start_time), nunca se interpola cruda");
});

test("grants: nexus_app solo puede SELECT la vista de transición, ningún privilegio en las tablas base", { skip: !TEST_DB_URL }, async () => {
  const viewGrants = await adminPool.query(
    `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='fieldbeat_working_hours_analysis_current' AND grantee='nexus_app'`
  );
  assert.deepEqual(viewGrants.rows.map(r => r.privilege_type), ["SELECT"]);

  const baseGrants = await adminPool.query(
    `SELECT table_name FROM information_schema.role_table_grants WHERE grantee='nexus_app' AND table_name IN ('fieldbeat_working_hours_analysis_v2','fieldbeat_contract_coverage_segments','fieldbeat_working_hours_equipment_links')`
  );
  assert.equal(baseGrants.rows.length, 0);
});

test("compatibilidad: los campos históricos del contrato (§3) siguen presentes en detail", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/detail/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/detail", { pageSize: "20" }));
  const body = await res.json();
  const row = body.rows[0];
  for (const field of [
    "business_hours", "after_hours", "weekend_hours", "holiday_hours", "after_hours_rate",
    "confidence_score", "confidence_label", "confidence_factors", "calculation_method",
    "reported_end_raw", "start_time", "duration_hours", "calculation_status"
  ]) {
    assert.ok(field in row, `campo histórico ausente: ${field}`);
  }
});
