// Pruebas de integración de GET /api/dashboard/after-hours/export - misma
// base desechable y mismo patrón que test/after-hours/api.integration.test.ts
// (fixtures reales en marts.fieldbeat_working_hours_analysis_v2, la ruta
// bajo prueba se llama directamente, nunca se reimplementa su lógica) y
// test/audit/exports.integration.test.ts (verificación del evento de
// auditoría vía governance.command_events). Se salta entera si
// AFTER_HOURS_TEST_DATABASE_URL no está seteada.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "after-hours-export-route-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;
let builderRunId: string;

const GERENCIA_ACTOR_ID = "99999999-9999-9999-9999-999999999991";
const TASK_NORMAL = 820001; // acentos/ñ (Clínica Ñuñoa / José Muñoz), CONTRACTUAL
const TASK_INJECTION = 820002; // client_name empieza con "=" (inyección de fórmula)
const TASK_OTHER_CLIENT = 820003; // cliente distinto, para probar que el filtro SÍ constriñe

function req(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: GERENCIA_ACTOR_ID, app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

async function insertTask(id: number, clientKey: string, assignedTo: string) {
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_tasks (fieldbeat_task_id, client_key, assigned_to, task_type, start_time, duration_minutes) VALUES ($1,$2,$3,'PM','2026-08-10T20:00:00Z',60)`,
    [id, clientKey, assignedTo]
  );
}

async function insertAnalysisRow(params: {
  id: number;
  clientKey: string;
  clientName: string;
  assignedTo: string;
}) {
  await adminPool.query(
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
     VALUES ($1,$2,$3,'PM',$4,
        '2026-08-10T20:00:00Z','2026-08-10T16:00:00','2026-08-10T21:00:00Z','2026-08-10T17:00:00',3600,
        1800,1800,1800,0,0,
        1800,0.5,true,
        'CALCULATED','PARTIALLY_COVERED','WITHIN_MATCHED_CONTRACT',
        'CALCULATED','PARTIALLY_COVERED','WITHIN_MATCHED_CONTRACT',false,
        90,'Alta','factores de prueba','ESTIMATED_FROM_START_DURATION',
        90,'Alta',
        'CONTRACTUAL',$5)`,
    [params.id, params.clientKey, params.clientName, params.assignedTo, builderRunId]
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

  const runRes = await adminPool.query(`INSERT INTO audit.pipeline_runs (stage, status) VALUES ('after-hours-export-route-test', 'SUCCESS') RETURNING run_id`);
  builderRunId = runRes.rows[0].run_id;

  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id IN ($1,$2,$3)`, [TASK_NORMAL, TASK_INJECTION, TASK_OTHER_CLIENT]);
  await adminPool.query(`DELETE FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id IN ($1,$2,$3)`, [TASK_NORMAL, TASK_INJECTION, TASK_OTHER_CLIENT]);

  await insertTask(TASK_NORMAL, "CLI-EXPORT-1", "José Muñoz");
  await insertTask(TASK_INJECTION, "CLI-EXPORT-1", "José Muñoz");
  await insertTask(TASK_OTHER_CLIENT, "CLI-EXPORT-2", "Otro Técnico");

  await insertAnalysisRow({ id: TASK_NORMAL, clientKey: "CLI-EXPORT-1", clientName: "Clínica Ñuñoa", assignedTo: "José Muñoz" });
  await insertAnalysisRow({ id: TASK_INJECTION, clientKey: "CLI-EXPORT-1", clientName: "=cmd|'/c calc'!A1", assignedTo: "José Muñoz" });
  await insertAnalysisRow({ id: TASK_OTHER_CLIENT, clientKey: "CLI-EXPORT-2", clientName: "Cliente Distinto", assignedTo: "Otro Técnico" });
});

afterAll(async () => {
  if (!TEST_DB_URL) return;

  await adminPool.query(
    `DELETE FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1 AND after_state->>'entityType' = 'after-hours-detail'`,
    [GERENCIA_ACTOR_ID]
  );
  await adminPool.query(`DELETE FROM marts.fieldbeat_working_hours_analysis_v2 WHERE fieldbeat_task_id IN ($1,$2,$3)`, [TASK_NORMAL, TASK_INJECTION, TASK_OTHER_CLIENT]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id IN ($1,$2,$3)`, [TASK_NORMAL, TASK_INJECTION, TASK_OTHER_CLIENT]);

  await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("GET /api/dashboard/after-hours/export - integración", { skip: !TEST_DB_URL }, async t => {
  const { GET } = await import("../../app/api/dashboard/after-hours/export/route.ts");

  await t.test("rechaza sin sesión (401)", async () => {
    setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
    const response = await GET(req("/api/dashboard/after-hours/export"));
    assert.equal(response.status, 401);
  });

  await t.test("filtro por técnico produce un CSV consistente (headers correctos, BOM, acentos/ñ preservados, evento de auditoría registrado)", async () => {
    // Filtra por "technician" (columna assigned_to) - TASK_NORMAL y
    // TASK_INJECTION comparten responsable ("José Muñoz"), TASK_OTHER_CLIENT
    // tiene otro ("Otro Técnico"). "client" filtra por client_name, que
    // debe DIFERIR entre TASK_NORMAL y TASK_INJECTION (cada fixture prueba
    // un valor de columna distinto: acentos/ñ vs. inyección de fórmula), así
    // que un filtro por cliente único no podría capturar ambas filas a la vez.
    asGerencia();
    const response = await GET(req("/api/dashboard/after-hours/export", { technician: "José Muñoz" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
    assert.match(response.headers.get("Content-Disposition") ?? "", /^attachment; filename="nexus_fuera_de_horario_\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");

    const buffer = Buffer.from(await response.arrayBuffer());
    // BOM UTF-8 (EF BB BF) como primeros 3 bytes.
    assert.equal(buffer[0], 0xef);
    assert.equal(buffer[1], 0xbb);
    assert.equal(buffer[2], 0xbf);

    const text = buffer.toString("utf8");
    assert.ok(text.startsWith("﻿ID de tarea,Fecha,Hora de inicio,Hora de término,"), "encabezados en español, primer encabezado justo tras el BOM");

    // Solo las 2 filas del cliente CLI-EXPORT-1 (filtro sí constriñe -
    // TASK_OTHER_CLIENT, de otro cliente, nunca aparece).
    assert.ok(text.includes(String(TASK_NORMAL)));
    assert.ok(text.includes(String(TASK_INJECTION)));
    assert.ok(!text.includes(String(TASK_OTHER_CLIENT)));

    // Acentos/ñ preservados sin mojibake.
    assert.ok(text.includes("Clínica Ñuñoa"));
    assert.ok(text.includes("José Muñoz"));

    // Inyección de fórmula CSV neutralizada: prefijo ' antepuesto, y el
    // valor crudo nunca aparece inmediatamente tras una coma sin ese prefijo.
    assert.ok(text.includes("'=cmd|'/c calc'!A1"), "el valor con forma de fórmula debe llevar el prefijo defensivo '");
    assert.ok(!text.includes(",=cmd|"), "el valor nunca debe aparecer tras una coma sin el prefijo defensivo");

    const events = await adminPool.query(
      `SELECT after_state FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1 AND after_state->>'entityType' = 'after-hours-detail' ORDER BY id DESC LIMIT 1`,
      [GERENCIA_ACTOR_ID]
    );
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].after_state.rowCount, 2);
    assert.equal(events.rows[0].after_state.format, "csv");
    assert.ok(events.rows[0].after_state.filtersSummary.requestId, "debe registrar un requestId dentro de filtersSummary");
  });

  await t.test("filtro sin coincidencias -> 200 JSON explícito, nunca un CSV vacío ni evento de auditoría", async () => {
    asGerencia();
    const before = await adminPool.query(
      `SELECT count(*) AS n FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1`,
      [GERENCIA_ACTOR_ID]
    );
    const response = await GET(req("/api/dashboard/after-hours/export", { client: "cliente-inexistente-nx" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    const body = await response.json();
    assert.equal(body.code, "EXPORT_EMPTY_RESULT");

    const after = await adminPool.query(
      `SELECT count(*) AS n FROM governance.command_events WHERE event_type = 'EXPORT_COMPLETED' AND actor_user_id = $1`,
      [GERENCIA_ACTOR_ID]
    );
    assert.equal(after.rows[0].n, before.rows[0].n, "un resultado vacío nunca debe generar un evento EXPORT_COMPLETED");
  });

  await t.test("reportId inválido -> 400", async () => {
    asGerencia();
    const response = await GET(req("/api/dashboard/after-hours/export", { reportId: "no-es-un-numero" }));
    assert.equal(response.status, 400);
  });
});
