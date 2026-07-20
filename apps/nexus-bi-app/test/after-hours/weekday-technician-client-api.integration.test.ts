// Pruebas de integración de los 3 endpoints nuevos de ETAPA 6.6D
// (by-weekday, weekday-hour, technician-client) + autoexclusión de los 6
// agregados interactivos, contra un Postgres 16 real y DESECHABLE. Mismo
// mecanismo de seguridad y el mismo aislamiento que
// test/after-hours/api.integration.test.ts (ver ese archivo para el
// contexto completo del incidente ETAPA SAFETY-1), pero con su PROPIO
// rango de fieldbeat_task_id (810001-810009) y su propio `before()`, para
// no arriesgar ni modificar el fixture ya afinado de esa suite.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "after-hours-weekday-technician-client-test";
// ETAPA 6.6D-V - ver test/after-hours/api.integration.test.ts: este archivo
// también apunta siempre a un Postgres local desechable, nunca remoto -
// DATABASE_SSL_MODE=disable es necesario para que lib/db.ts::getPool no
// fuerce un handshake SSL contra un desechable recién creado sin SSL.
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

// 2026-08-10 es lunes (ISODOW=1), 2026-08-11 martes (2), 2026-08-12
// miércoles (3) - verificado por cálculo de calendario, no asumido.
const MON = "2026-08-10";
const TUE = "2026-08-11";
const WED = "2026-08-12";

before(async () => {
  if (!TEST_DB_URL) return;
  if (!TEST_RUN_ID) {
    throw new Error(`Falta AFTER_HOURS_TEST_RUN_ID -requerido junto con AFTER_HOURS_TEST_DATABASE_URL (ver scripts/bootstrap-disposable-postgres.mjs, ETAPA SAFETY-1).`);
  }
  printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
  adminPool = new Pool({ connectionString: TEST_DB_URL, ssl: false, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
  await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

  const runRes = await adminPool.query(`INSERT INTO audit.pipeline_runs (stage, status) VALUES ('after-hours-weekday-technician-client-test', 'SUCCESS') RETURNING run_id`);
  builderRunId = runRes.rows[0].run_id;

  // DELETE acotado EXCLUSIVAMENTE al rango propio de esta suite
  // (810001-810009) - nunca TRUNCATE de la tabla completa. Esta suite
  // corre en el mismo Postgres desechable que
  // test/after-hours/api.integration.test.ts (fixtures 800001-800005), y
  // `npm run test:integration` puede ejecutar ambos archivos con
  // antelación/paralelismo entre sí (node:test no serializa antes/tests de
  // archivos distintos de forma estricta) - un TRUNCATE de toda la tabla
  // acá borraría las filas de esa otra suite si su before() ya corrió,
  // sin importar el orden. Los rangos de id (800001-800005 vs
  // 810001-810009) son disjuntos a propósito para que ambas suites puedan
  // coexistir sin interferirse, cualquiera sea el orden/paralelismo real.
  await adminPool.query(`DELETE FROM marts.fieldbeat_working_hours_equipment_links WHERE working_hours_id IN (SELECT working_hours_id FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id BETWEEN 810001 AND 810009)`);
  await adminPool.query(`DELETE FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id BETWEEN 810001 AND 810009`);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN 810001 AND 810009`);

  for (const [id, client, tech, taskType] of [
    [810001, "ClienteA", "wtc_tech1", "PM"],
    [810002, "ClienteB", "wtc_tech2", "CM"],
    [810003, "ClienteSinTecnico", "wtc_tech1", "PM"],
    [810004, "ClienteConTecnicoSinCliente", "wtc_tech3", "PM"],
    [810005, "ClienteEspacios", "wtc_tech1", "PM"],
    [810006, "ClienteC", "wtc_tech4", "CM"],
    [810007, "ClienteTie", "TechTieA", "PM"],
    [810008, "ClienteTie", "TechTieB", "PM"],
    [810009, "ClienteA", "wtc_tech1", "PM"]
  ] as const) {
    await adminPool.query(
      `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, client_key, assigned_to, task_type, start_time, duration_minutes) VALUES ($1,$2,$3,$4,'2026-08-10T20:00:00Z',60)`,
      [id, client, tech, taskType]
    );
  }

  // 810001: lunes 16:00, wtc_tech1/ClienteA - fixture "con datos" base.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (810001,'CLI-A','ClienteA','PM','wtc_tech1',
        '${MON}T20:00:00Z','${MON}T16:00:00','${MON}T21:00:00Z','${MON}T17:00:00',3600,
        1800,1800,1800,0,0,
        1800,0.5,true,
        'CALCULATED','PARTIALLY_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        80,'Media','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );

  // 810002: martes 09:00, wtc_tech2/ClienteB - día y hora distintos, en horario
  // (after_hours_total=0) - para probar que by-weekday/weekday-hour no
  // pierden tareas "dentro de horario".
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (810002,'CLI-B','ClienteB','CM','wtc_tech2',
        '${TUE}T13:00:00Z','${TUE}T09:00:00','${TUE}T14:00:00Z','${TUE}T10:00:00',3600,
        3600,0,0,0,0,
        0,0,false,
        'CALCULATED','FULLY_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        85,'Alta','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );

  // 810003: técnico NULL, lunes 16:00 - excluido de technician-client.rows,
  // contado en by-weekday/weekday-hour como cualquier otra tarea con fecha.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (810003,'CLI-STN','ClienteSinTecnico','PM',NULL,
        '${MON}T20:00:00Z','${MON}T16:00:00','${MON}T20:30:00Z','${MON}T16:30:00',1800,
        0,1800,1800,0,0,
        1800,1,true,
        'CALCULATED','NOT_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        60,'Baja','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );

  // 810004: cliente NULL, lunes 16:00 - excluido de technician-client.rows.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (810004,'CLI-NULL',NULL,'PM','wtc_tech3',
        '${MON}T20:00:00Z','${MON}T16:00:00','${MON}T20:30:00Z','${MON}T16:30:00',1800,
        0,1800,1800,0,0,
        1800,1,true,
        'CALCULATED','NOT_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        60,'Baja','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );

  // 810005: técnico compuesto SOLO por espacios ("   ") - debe tratarse
  // como ausente vía NULLIF(BTRIM(...), ''), igual que NULL/'' -nunca una
  // identidad real distinta.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (810005,'CLI-ESP','ClienteEspacios','PM','   ',
        '${MON}T20:00:00Z','${MON}T16:00:00','${MON}T20:30:00Z','${MON}T16:30:00',1800,
        0,1800,1800,0,0,
        1800,1,true,
        'CALCULATED','NOT_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        60,'Baja','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );

  // 810006: NONE terminal (intervalo nunca resuelto, sin start_time_local)
  // - cuenta en tasksWithoutDate de by-weekday/weekday-hour, y aparece
  // normalmente en technician-client.rows (técnico/cliente SÍ están
  // identificados, solo falta la fecha - son conceptos independientes).
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        calculation_method, data_basis, builder_run_id)
     VALUES (810006,'CLI-C','ClienteC','CM','wtc_tech4',
        'NOT_CALCULABLE','NOT_CALCULABLE','INSUFFICIENT_DATA',
        'NOT_CALCULABLE','NOT_CALCULABLE','INSUFFICIENT_DATA',false,
        'INSUFFICIENT_DATA','NONE',$1)`,
    [builderRunId]
  );

  // 810007/810008: mismo cliente ("ClienteTie"), técnicos distintos
  // ("TechTieA"/"TechTieB"), MISMO after_hours_total_seconds (2400s = 40min,
  // valor no compartido por ningún otro fixture) - para probar el
  // desempate determinista ORDER BY assigned_to ASC cuando la métrica
  // principal empata exacto.
  for (const [id, tech] of [
    [810007, "TechTieA"],
    [810008, "TechTieB"]
  ] as const) {
    await adminPool.query(
      `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
         (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
          start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
          covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
          after_hours_total_seconds, after_hours_rate, is_after_hours_task,
          calculation_status, coverage_classification, coverage_reason_code,
          contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
          confidence_score, confidence_label, calculation_method,
          data_basis, builder_run_id)
       VALUES ($1,'CLI-TIE','ClienteTie','PM',$2,
          '${MON}T20:00:00Z','${MON}T16:00:00','${MON}T21:00:00Z','${MON}T17:00:00',3600,
          1200,2400,2400,0,0,
          2400,0.6667,true,
          'CALCULATED','PARTIALLY_COVERED','WITHIN_LEGACY_SCHEDULE',
          'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
          75,'Media','ESTIMATED_FROM_START_DURATION',
          'LEGACY_SCHEDULE',$3)`,
      [id, tech, builderRunId]
    );
  }

  // 810009: miércoles 00:00 (hour=0, medianoche) - mismo par wtc_tech1/ClienteA
  // que 810001, para probar que hour=0 se trata correctamente (nunca como
  // "sin hora") y que el par (wtc_tech1,ClienteA) agrega sobre AMBAS tareas.
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_working_hours_analysis_v2
       (fieldbeat_task_id, client_key, client_name, task_type, assigned_to,
        start_time_utc, start_time_local, end_time_utc, end_time_local, duration_seconds,
        covered_seconds, outside_coverage_seconds, after_hours_weekday_seconds, weekend_seconds, holiday_seconds,
        after_hours_total_seconds, after_hours_rate, is_after_hours_task,
        calculation_status, coverage_classification, coverage_reason_code,
        contractual_attempt_status, contractual_coverage_classification, contractual_reason_code, fallback_used,
        confidence_score, confidence_label, calculation_method,
        data_basis, builder_run_id)
     VALUES (810009,'CLI-A','ClienteA','PM','wtc_tech1',
        '${WED}T04:00:00Z','${WED}T00:00:00','${WED}T05:00:00Z','${WED}T01:00:00',3600,
        3600,0,0,0,0,
        0,0,false,
        'CALCULATED','FULLY_COVERED','WITHIN_LEGACY_SCHEDULE',
        'NOT_CALCULABLE','NOT_CALCULABLE','EQUIPMENT_UNMATCHED',true,
        80,'Media','ESTIMATED_FROM_START_DURATION',
        'LEGACY_SCHEDULE',$1)`,
    [builderRunId]
  );
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
});

// Filtro que aísla esta suite del resto del universo real de la base
// desechable (que puede tener miles de filas de otras suites/certificación
// BDD previa) - todas las pruebas acotan por client_name IN (...) de estos
// 9 fixtures salvo que se indique lo contrario.
const FIXTURE_CLIENTS = ["ClienteA", "ClienteB", "ClienteSinTecnico", "ClienteConTecnicoSinCliente", "ClienteEspacios", "ClienteC", "ClienteTie"];

function sumTotalTasks(rows: Array<{ total_tasks: number }>): number {
  return rows.reduce((acc, r) => acc + r.total_tasks, 0);
}

// === by-weekday ===

test("by-weekday: siempre 7 filas en orden lunes->domingo, incluso sin filtros sobre un universo mayor", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-weekday", { technician: "wtc_tech1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows.length, 7);
  assert.deepEqual(body.rows.map((r: { key: string }) => r.key), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("by-weekday: agrupa correctamente lunes/martes/miércoles para los fixtures de wtc_tech1 (810001,810009 lunes+miércoles)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-weekday", { technician: "wtc_tech1" }));
  const body = await res.json();
  const monday = body.rows.find((r: { key: string }) => r.key === "1");
  const wednesday = body.rows.find((r: { key: string }) => r.key === "3");
  // wtc_tech1 aparece en 810001 (lunes), 810003 (lunes, pero SIN técnico -> no
  // debería contar para technician=wtc_tech1... ojo: el filtro technician
  // filtra la VISTA por assigned_to='wtc_tech1', 810003 tiene assigned_to NULL,
  // nunca matchea `= 'wtc_tech1'` -> correctamente excluida de este filtro.
  assert.equal(monday.total_tasks, 1); // solo 810001
  assert.equal(wednesday.total_tasks, 1); // solo 810009
});

test("by-weekday: tasksWithoutDate cuenta 810006 (NONE terminal, sin start_time_local) para wtc_tech4", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-weekday", { technician: "wtc_tech4" }));
  const body = await res.json();
  assert.equal(body.tasksWithoutDate, 1);
  assert.equal(sumTotalTasks(body.rows), 0);
});

test("by-weekday: invariante de reconciliación exacta SUM(rows.total_tasks) + tasksWithoutDate === aggregationUniverseTotal (sin filtros de autoexclusión activos, coincide con /summary del mismo universo)", { skip: !TEST_DB_URL }, async () => {
  const { GET: getByWeekday } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const { GET: getSummary } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const body = await (await getByWeekday(req("/api/dashboard/after-hours/by-weekday", { technician: "wtc_tech1" }))).json();
  const summaryBody = await (await getSummary(req("/api/dashboard/after-hours/summary", { technician: "wtc_tech1" }))).json();

  assert.equal(sumTotalTasks(body.rows) + body.tasksWithoutDate, body.aggregationUniverseTotal);
  // wtc_tech1 sin filtro de weekday activo -> aggregationUniverseTotal coincide con /summary?technician=wtc_tech1.
  assert.equal(body.aggregationUniverseTotal, summaryBody.total_tasks);
});

test("by-weekday: AUTOEXCLUSIÓN - con ?weekday=1 activo, sigue devolviendo los 7 días completos (nunca colapsa a solo lunes)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const res = await GET(req("/api/dashboard/after-hours/by-weekday", { technician: "wtc_tech1", weekday: "1" }));
  const body = await res.json();
  assert.equal(body.rows.length, 7);
  const monday = body.rows.find((r: { key: string }) => r.key === "1");
  const wednesday = body.rows.find((r: { key: string }) => r.key === "3");
  assert.equal(monday.total_tasks, 1); // 810001
  assert.equal(wednesday.total_tasks, 1, "miércoles (810009) NO debería desaparecer solo porque ?weekday=1 esté activo - la autoexclusión lo ignora a propósito");
});

test("by-weekday: con ?weekday=1 activo, aggregationUniverseTotal IGNORA ese filtro (no coincide con /summary?weekday=1, que sí lo aplica de verdad)", { skip: !TEST_DB_URL }, async () => {
  const { GET: getByWeekday } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const { GET: getSummary } = await import("../../app/api/dashboard/after-hours/summary/route.ts");
  const body = await (await getByWeekday(req("/api/dashboard/after-hours/by-weekday", { technician: "wtc_tech1", weekday: "1" }))).json();
  const summaryBody = await (await getSummary(req("/api/dashboard/after-hours/summary", { technician: "wtc_tech1", weekday: "1" }))).json();

  assert.equal(body.aggregationUniverseTotal, 2, "wtc_tech1 tiene 2 tareas en total (810001 lunes + 810009 miércoles), ignorando weekday");
  assert.equal(summaryBody.total_tasks, 1, "/summary SÍ aplica weekday=1 de verdad -solo cuenta 810001 (lunes)");
  assert.notEqual(body.aggregationUniverseTotal, summaryBody.total_tasks, "divergencia esperada: by-weekday autoexcluye weekday, /summary no");
});

test("by-weekday: orden determinista lunes->domingo sin importar qué día tiene más actividad", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/by-weekday", { client: "ClienteTie" }))).json();
  assert.deepEqual(body.rows.map((r: { key: string }) => r.key), ["1", "2", "3", "4", "5", "6", "7"]);
});

// === weekday-hour ===

test("weekday-hour: siempre 168 celdas, identidad (weekday,hour) como columnas propias", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/weekday-hour/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/weekday-hour", { technician: "wtc_tech1" }))).json();
  assert.equal(body.cells.length, 168);
  assert.ok(body.cells.every((c: { weekday: number; hour: number }) => typeof c.weekday === "number" && typeof c.hour === "number"));
});

test("weekday-hour: hour=0 (medianoche) se agrega correctamente, nunca se trata como ausente", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/weekday-hour/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/weekday-hour", { technician: "wtc_tech1" }))).json();
  const wedMidnight = body.cells.find((c: { weekday: number; hour: number }) => c.weekday === 3 && c.hour === 0);
  assert.equal(wedMidnight.total_tasks, 1); // 810009
});

test("weekday-hour: reconciliación exacta SUM(cells.total_tasks) + tasksWithoutDate === aggregationUniverseTotal", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/weekday-hour/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/weekday-hour", { technician: "wtc_tech4" }))).json();
  const sum = body.cells.reduce((acc: number, c: { total_tasks: number }) => acc + c.total_tasks, 0);
  assert.equal(sum + body.tasksWithoutDate, body.aggregationUniverseTotal);
  assert.equal(body.tasksWithoutDate, 1); // 810006, wtc_tech4, sin start_time_local
});

test("weekday-hour: AUTOEXCLUSIÓN - con ?weekday=1&hour=16 activos, sigue devolviendo las 168 celdas completas (incluye martes 09:00)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/weekday-hour/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/weekday-hour", { client: "ClienteB", weekday: "1", hour: "16" }))).json();
  assert.equal(body.cells.length, 168);
  const tuesdayNine = body.cells.find((c: { weekday: number; hour: number }) => c.weekday === 2 && c.hour === 9);
  assert.equal(tuesdayNine.total_tasks, 1, "martes 09:00 (810002) no debería desaparecer por tener ?weekday=1&hour=16 activo");
});

// === technician-client ===

test("technician-client: agrupa por (técnico,cliente), key=técnico, extra=cliente", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/technician-client"))).json();
  const pair = body.rows.find((r: { key: string; extra: string }) => r.key === "wtc_tech1" && r.extra === "ClienteA");
  assert.ok(pair, "debe existir el par wtc_tech1/ClienteA");
  assert.equal(pair.total_tasks, 2, "810001 (lunes) + 810009 (miércoles) agregan sobre el MISMO par");
});

// Identidad de técnico de ESTA suite únicamente (prefijo wtc_/TechTie) -
// permite aislar "mis" filas del resto del universo aunque coexistan en la
// misma base desechable con test/after-hours/api.integration.test.ts
// (fixtures 800001-800005, técnicos "tech1"/"tech2" SIN el prefijo -
// colisión evitada a propósito). `client`/`technician` no sirven para
// acotar la LLAMADA (technician-client los autoexcluye de sí mismo), así
// que el aislamiento se hace del lado del array de respuesta.
const MY_TECHNICIANS = ["wtc_tech1", "wtc_tech2", "wtc_tech4", "TechTieA", "TechTieB"];

test("technician-client: técnico NULL, cliente NULL y técnico solo-espacios se cuentan en excludedTasks, NUNCA en rows", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/technician-client"))).json();
  const myRows = body.rows.filter((r: { key: string }) => MY_TECHNICIANS.includes(r.key));
  assert.equal(myRows.length, 5, "5 pares reales: wtc_tech1/ClienteA, wtc_tech2/ClienteB, TechTieA/ClienteTie, TechTieB/ClienteTie, wtc_tech4/ClienteC");
  assert.ok(
    !body.rows.some((r: { key: string | null; extra: string | null }) => r.key === null || r.extra === null),
    "ningún row expone key/extra null - esas tareas se excluyen por completo, nunca aparecen con una identidad null"
  );
  // excludedTasks es un contador global (no por técnico), pero ningún
  // fixture de la suite hermana tiene técnico/cliente ausente -por eso
  // estas 3 (810003/810004/810005) son un piso exacto, sin importar si esa
  // otra suite ya insertó sus datos en la misma base.
  assert.ok(body.excludedTasks >= 3, "810003 (sin técnico) + 810004 (sin cliente) + 810005 (técnico solo espacios) deben estar excluidas");
});

test("technician-client: reconciliación exacta SUM(rows.total_tasks) + excludedTasks === aggregationUniverseTotal (fórmula, no un total absoluto - robusta a la coexistencia con otras suites en la misma base)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/technician-client"))).json();
  const sum = sumTotalTasks(body.rows);
  assert.equal(sum + body.excludedTasks, body.aggregationUniverseTotal);

  const myRows = body.rows.filter((r: { key: string }) => MY_TECHNICIANS.includes(r.key));
  assert.equal(sumTotalTasks(myRows), 6, "2(wtc_tech1/ClienteA)+1(wtc_tech2/ClienteB)+1(TechTieA)+1(TechTieB)+1(wtc_tech4/ClienteC)");
});

test("technician-client: AUTOEXCLUSIÓN - con ?technician=wtc_tech1&client=ClienteA activos (el propio par), siguen apareciendo OTROS pares", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/technician-client", { technician: "wtc_tech1", client: "ClienteA" }))).json();
  const other = body.rows.find((r: { key: string; extra: string }) => r.key === "wtc_tech2" && r.extra === "ClienteB");
  assert.ok(other, "wtc_tech2/ClienteB no debería desaparecer solo porque wtc_tech1/ClienteA esté seleccionado como filtro (technician-client autoexcluye ambos)");
});

test("technician-client: orden determinista - desempate estable por técnico ASC cuando la métrica principal empata exacto", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/technician-client"))).json();
  const indexA = body.rows.findIndex((r: { key: string }) => r.key === "TechTieA");
  const indexB = body.rows.findIndex((r: { key: string }) => r.key === "TechTieB");
  assert.ok(indexA !== -1 && indexB !== -1, "ambos pares deben existir");
  assert.equal(body.rows[indexA].after_hours_total_hours, body.rows[indexB].after_hours_total_hours, "precondición del test: deben empatar exacto");
  assert.ok(indexA < indexB, "con métrica empatada, TechTieA (ASC) debe ir antes que TechTieB");
});

test("technician-client: empty state semántico - rows=0 y excludedTasks=0 (filtro no autoexcluido sin ningún fixture) es vacío genuino", { skip: !TEST_DB_URL }, async () => {
  // `client`/`technician` no sirven acá para forzar un resultado vacío
  // (autoexcluidos por diseño) - se usa `taskType`, un filtro que SÍ se
  // aplica de verdad sobre este endpoint, con un valor que ningún fixture
  // de esta suite tiene.
  const { GET } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");
  const body = await (await GET(req("/api/dashboard/after-hours/technician-client", { taskType: "TIPO_QUE_NO_EXISTE" }))).json();
  assert.equal(body.rows.length, 0);
  assert.equal(body.excludedTasks, 0);
  assert.equal(body.aggregationUniverseTotal, 0);
});

// === SQL parametrizado / error controlado (regresión de higiene, compartida por los 3 endpoints nuevos) ===

test("los 3 endpoints nuevos responden 200 con filtros combinados (fecha + dataBasis + weekday) sin importar el orden de construcción de condiciones", { skip: !TEST_DB_URL }, async () => {
  const { GET: getByWeekday } = await import("../../app/api/dashboard/after-hours/by-weekday/route.ts");
  const { GET: getWeekdayHour } = await import("../../app/api/dashboard/after-hours/weekday-hour/route.ts");
  const { GET: getTechnicianClient } = await import("../../app/api/dashboard/after-hours/technician-client/route.ts");

  const params = { from: "2026-01-01", to: "2026-12-31", dataBasis: "LEGACY_SCHEDULE", client: "ClienteA" };
  for (const getFn of [getByWeekday, getWeekdayHour, getTechnicianClient]) {
    const res = await getFn(req("/api/dashboard/after-hours/x", params));
    assert.equal(res.status, 200);
  }
});
