// HOTFIX de integridad de datos (post-Phase 6) - pruebas de integración de
// las vistas nuevas quality.fieldbeat_report_participants,
// quality.fieldbeat_report_part_occurrences y quality.fieldbeat_report_labor_summary
// (sql/088_fieldbeat_part_occurrences_and_participants.sql), mismo mecanismo
// de Postgres desechable que test/fieldbeat/quality-api.integration.test.ts.
//
// Rango de fieldbeat_task_id propio (905001-905003) y client_key con
// prefijo "HOTFIX|" - disjunto de todos los rangos ya usados en el repo.
// El fixture 905001 reproduce EXACTAMENTE la forma real del reporte 3453
// (verificada contra el PDF real exportado de FieldBeat y el JSON crudo):
// Manuel Reyes principal, Alexis Acevedo adicional vía "OTROS (COMENTE)",
// Thyratron/CX1551G sin match de catálogo, intervalo declarado 09:50-12:00
// (130 min), duration=120 (estimado, nunca usado como real).
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_088_PATH = path.join(__dirname, "..", "..", "..", "..", "sql", "088_fieldbeat_part_occurrences_and_participants.sql");

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "fieldbeat-participants-part-occurrences-hotfix-test";

// Mismo patrón que test/fieldbeat/quality-api.integration.test.ts - la ruta
// real GET /api/dashboard/fieldbeat/reports usa lib/db.ts::getPool(), que
// lee SUPABASE_DB_URL directo del entorno (nunca AFTER_HOURS_TEST_DATABASE_URL).
if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_KEY = "HOTFIX|55.555.555-5|Cliente Fixture Hotfix";
const CLIENT_NAME = "Cliente Fixture Hotfix";
const ID_MIN = 905001;
const ID_MAX = 905004;

const REPORT_3453_LIKE = 905001; // Manuel Reyes + Alexis Acevedo + CX1551G
const REPORT_MINIMAL = 905002; // sin participantes adicionales, sin repuestos
const REPORT_UNRESOLVED = 905003; // participante adicional no resoluble
const REPORT_STRUCTURED_ADDITIONAL = 905004; // adicional ESTRUCTURADO (no via "OTROS"), debe resolver contra el roster

async function insertTask(
  pool: pg.Pool,
  row: { id: number; assignedTo: string | null; startTime?: string; lastTransitionAt?: string; durationMinutes?: number | null }
) {
  await pool.query(
    `INSERT INTO processed.fieldbeat_tasks
       (fieldbeat_task_id, client_key, assigned_to, task_type, state, start_time, last_transition_at, duration_minutes, created_at, created_in)
     VALUES ($1,$2,$3,'CORRECTIVA PROGRAMADA','FINISHED',$4,$5,$6,'2026-01-05T15:09:50.486Z','APK')`,
    [
      row.id,
      CLIENT_KEY,
      row.assignedTo,
      row.startTime ?? "2026-01-05T15:00:00Z",
      row.lastTransitionAt ?? "2026-01-05T15:16:29Z",
      row.durationMinutes === undefined ? 120 : row.durationMinutes
    ]
  );
}

async function insertMartRow(pool: pg.Pool, row: { id: number; technicianNames?: string }) {
  await pool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
       (fieldbeat_task_id, fieldbeat_task_date, client_key, client_name, task_type, task_state, technician_names, equipment_internal_ids, used_parts_count, report_quality_status)
     VALUES ($1,'2026-01-05T12:50:00Z',$2,$3,'CORRECTIVA PROGRAMADA','FINISHED',$4,'',0,'NO_USED_PARTS')`,
    [row.id, CLIENT_KEY, CLIENT_NAME, row.technicianNames ?? ""]
  );
}

async function insertReportField(
  pool: pg.Pool,
  row: { taskId: number; groupName: string; groupIndex: number; fieldName: string; fieldIndex: number; fieldValue: string | null; fieldComment?: string | null; possibleValues?: string | null }
) {
  await pool.query(
    `INSERT INTO processed.fieldbeat_report_fields
       (report_field_id, fieldbeat_task_id, group_name, group_index, group_copy_of, is_group_copy, field_name, field_index, field_type, field_value, field_comment, mandatory, possible_values, etag, extracted_at)
     VALUES ($1,$2,$3,$4,'',false,$5,$6,'TEXT',$7,$8,false,$9,'','2026-07-01T18:10:26.296Z')`,
    [
      `${row.taskId}|${row.groupName}|${row.groupIndex}|${row.fieldName}|${row.fieldIndex}`,
      row.taskId,
      row.groupName,
      row.groupIndex,
      row.fieldName,
      row.fieldIndex,
      row.fieldValue,
      row.fieldComment ?? null,
      row.possibleValues ?? null
    ]
  );
}

async function insertUsedPart(
  pool: pg.Pool,
  row: { taskId: number; partNumber: string; partName: string; quantity: number; originLocation: string; originComment?: string | null; photoRef?: string | null }
) {
  await pool.query(
    `INSERT INTO processed.fieldbeat_used_parts
       (used_part_id, fieldbeat_task_id, part_number, part_name, quantity, raw_original_part_number, raw_original_part_name, origin_location, origin_comment, photo_ref, dolibarr_product_id, dolibarr_ref, needs_manual_review)
     VALUES ($1,$2,$3,$4,$5,$3,$4,$6,$7,$8,NULL,$3,false)`,
    [`${row.taskId}|1|0|${row.partNumber}`, row.taskId, row.partNumber, row.partName, row.quantity, row.originLocation, row.originComment ?? null, row.photoRef ?? null]
  );
  await pool.query(
    `INSERT INTO marts.used_parts_dolibarr_match
       (used_part_id, fieldbeat_task_id, part_name, raw_part_identifier, normalized_part_identifier, match_method, match_confidence, match_status, needs_manual_review)
     VALUES ($1,$2,$3,$4,$4,'NONE',0,'NO_MATCH',true)`,
    [`${row.taskId}|1|0|${row.partNumber}`, row.taskId, row.partName, row.partNumber]
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

  await adminPool.query(`DELETE FROM marts.used_parts_dolibarr_match WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_used_parts WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_report_fields WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);

  // HOTFIX de integridad de datos FieldBeat - separador CORREGIDO a coma:
  // verificado contra las 3773 filas reales de possible_values en
  // processed.fieldbeat_report_fields (16 valores distintos, 0 contienen
  // '|') que el dropdown SIEMPRE se serializa con coma, igual que
  // field_value. Este fixture usaba '|' por error (replicando el mismo bug
  // que tenía quality.fieldbeat_engineer_roster en sql/088, nunca detectado
  // porque ambos coincidían) - corregido tras reprocesar el universo real
  // de 3747 reportes y encontrar QUE NINGUNA selección estructurada
  // resolvía contra el roster (100% caía a UNRESOLVED_UNKNOWN_TOKEN).
  const ROSTER = "ROBERTO AGUILA,VICTOR ARENAS,EDUARDO BECKER,RUBEN CAMMALLERI,CARLOS CARRASQUEL,JOSE ECHEVERRIA,GONZALO LOPEZ,MANUEL REYES,MAURICIO ABREU,SEBASTIAN SALICE,OTROS (COMENTE),ALEXIS ECHEVERRÍA,JAIME BUSTAMANTE,JORGE ACUÑA,ANDREE DIAZ,GONZALO H. LOPEZ";

  // 905001: reproduce 3453 - Manuel Reyes principal, Alexis Acevedo
  // adicional vía "OTROS (COMENTE)", intervalo declarado 09:50-12:00 (130
  // min real), duration=120 (estimado, nunca real), Thyratron/CX1551G sin
  // match de catálogo, origen "Otros (Comente)" con comentario real.
  await insertTask(adminPool, { id: REPORT_3453_LIKE, assignedTo: "mreyes", startTime: "2026-01-05T15:00:00Z", lastTransitionAt: "2026-01-05T15:16:29Z", durationMinutes: 120 });
  // technician_names refleja el nombre real mostrado en la mart (no el
  // username crudo "mreyes") - así lo busca un usuario real en el filtro
  // de "Técnico responsable" (technicianRole=primary).
  await insertMartRow(adminPool, { id: REPORT_3453_LIKE, technicianNames: "Manuel Reyes" });
  await insertReportField(adminPool, {
    taskId: REPORT_3453_LIKE, groupName: "DESCRIPCIÓN DE LA INTERVENCIÓN", groupIndex: 1,
    fieldName: "HORA DE INICIO DEL TRABAJO", fieldIndex: 3, fieldValue: "05/01/2026 09:50"
  });
  await insertReportField(adminPool, {
    taskId: REPORT_3453_LIKE, groupName: "DESCRIPCIÓN DE LA INTERVENCIÓN", groupIndex: 1,
    fieldName: "HORA DE TERMINO DEL TRABAJO", fieldIndex: 4, fieldValue: "05/01/2026 12:00"
  });
  await insertReportField(adminPool, {
    taskId: REPORT_3453_LIKE, groupName: "DESCRIPCIÓN DE LA INTERVENCIÓN", groupIndex: 1,
    fieldName: "NOMBRE DEL INGENIERO ADICIONAL", fieldIndex: 5, fieldValue: "MANUEL REYES,OTROS (COMENTE)",
    fieldComment: "Alexis Acevedo", possibleValues: ROSTER
  });
  await insertUsedPart(adminPool, {
    taskId: REPORT_3453_LIKE, partNumber: "CX1551G", partName: "Thyratron", quantity: 1,
    originLocation: "Otros (Comente)", originComment: "Repuesto proporcionado por el cliente", photoRef: "D5830A753933FF1FCD44A4839580A1D9.png"
  });

  // 905002: minimal - solo responsable principal, sin adicionales, sin repuestos.
  await insertTask(adminPool, { id: REPORT_MINIMAL, assignedTo: "jecheverria", durationMinutes: null });
  await insertMartRow(adminPool, { id: REPORT_MINIMAL, technicianNames: "jecheverria" });

  // 905003: participante adicional NO resoluble (nombre que no calza con
  // roster ni con el mapa de identidad) - debe conservarse, nunca descartarse.
  await insertTask(adminPool, { id: REPORT_UNRESOLVED, assignedTo: "jecheverria" });
  await insertMartRow(adminPool, { id: REPORT_UNRESOLVED, technicianNames: "jecheverria" });
  await insertReportField(adminPool, {
    taskId: REPORT_UNRESOLVED, groupName: "DESCRIPCIÓN DE LA INTERVENCIÓN", groupIndex: 1,
    fieldName: "NOMBRE DEL INGENIERO ADICIONAL", fieldIndex: 5, fieldValue: "OTROS (COMENTE)",
    fieldComment: "Persona Desconocida XYZ", possibleValues: ROSTER
  });

  // 905004: adicional ESTRUCTURADO real (selección directa del roster, sin
  // pasar por "OTROS (COMENTE)") - Gonzalo Lopez adicional a Manuel Reyes
  // (responsable principal, deduplicado). Regresión real encontrada al
  // reprocesar el universo completo de 3747 reportes: el separador de
  // possible_values en quality.fieldbeat_engineer_roster estaba mal (pipe en
  // vez de coma), lo que hacía que ESTE caso (selección estructurada válida)
  // cayera a UNRESOLVED_UNKNOWN_TOKEN en vez de RESOLVED_ROSTER_MATCH.
  await insertTask(adminPool, { id: REPORT_STRUCTURED_ADDITIONAL, assignedTo: "mreyes" });
  await insertMartRow(adminPool, { id: REPORT_STRUCTURED_ADDITIONAL, technicianNames: "Manuel Reyes" });
  await insertReportField(adminPool, {
    taskId: REPORT_STRUCTURED_ADDITIONAL, groupName: "DESCRIPCIÓN DE LA INTERVENCIÓN", groupIndex: 1,
    fieldName: "NOMBRE DEL INGENIERO ADICIONAL", fieldIndex: 5, fieldValue: "MANUEL REYES,GONZALO LOPEZ",
    possibleValues: ROSTER
  });

  // El resumen laboral consume exclusivamente el intervalo canónico ya
  // materializado por working-hours. El fixture debe recorrer el mismo
  // pipeline productivo: nunca reintroducir un parser SQL paralelo dentro
  // de quality.fieldbeat_report_labor_summary.
  process.env.WORKING_HOURS_DB_URL = TEST_DB_URL;
  // @ts-expect-error El builder raíz es JavaScript ESM y no publica .d.ts.
  const { runApply } = await import("../../../../src/working-hours/build-working-hours.js");
  const previousCwd = process.cwd();
  process.chdir(path.join(__dirname, "..", "..", "..", ".."));
  try {
    const applyResult = await runApply({ from: null, to: null });
    assert.equal(applyResult.ok, true, "el builder canónico debe publicar los intervalos temporales del fixture");
  } finally {
    process.chdir(previousCwd);
  }
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
  setAuthorizationProviderForTests(null);
});

function reportsReq(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/dashboard/fieldbeat/reports");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "participants-hotfix-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

test("quality.fieldbeat_report_participants: Manuel Reyes principal (1 sola fila), Alexis Acevedo adicional texto libre, nunca duplicado", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT raw_name, normalized_name, role, source_type, resolution_status, is_primary
     FROM quality.fieldbeat_report_participants WHERE fieldbeat_task_id = $1 ORDER BY is_primary DESC, raw_name`,
    [REPORT_3453_LIKE]
  );
  const rows = res.rows;
  const primaryRows = rows.filter(r => r.is_primary);
  assert.equal(primaryRows.length, 1, "exactamente 1 fila PRIMARY_ASSIGNEE");
  assert.equal(primaryRows[0].role, "PRIMARY_ASSIGNEE");
  assert.equal(primaryRows[0].normalized_name, "MANUEL REYES");

  const manuelDuplicateAsAdditional = rows.filter(r => !r.is_primary && r.normalized_name === "MANUEL REYES");
  assert.equal(manuelDuplicateAsAdditional.length, 0, "Manuel Reyes NUNCA debe aparecer duplicado como adicional");

  const alexis = rows.find(r => r.raw_name === "Alexis Acevedo");
  assert.ok(alexis, "Alexis Acevedo debe estar presente como participante");
  assert.equal(alexis.role, "ADDITIONAL_FREE_TEXT");
  assert.equal(alexis.source_type, "REPORT_FIELD_FREE_TEXT_COMMENT");
  assert.equal(alexis.resolution_status, "UNRESOLVED_FREE_TEXT", "Alexis no está en el roster -no se inventa una identidad resuelta");

  assert.equal(rows.length, 2, "exactamente 2 participantes para el reporte 3453-like: Manuel (principal) + Alexis (adicional)");
});

test("quality.fieldbeat_report_participants: reporte minimo (905002) tiene solo el principal, sin filas adicionales fantasma", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(`SELECT role FROM quality.fieldbeat_report_participants WHERE fieldbeat_task_id = $1`, [REPORT_MINIMAL]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].role, "PRIMARY_ASSIGNEE");
});

test("quality.fieldbeat_report_participants: participante no resoluble se conserva (nunca se descarta)", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT raw_name, role, resolution_status FROM quality.fieldbeat_report_participants WHERE fieldbeat_task_id = $1 AND is_primary = false`,
    [REPORT_UNRESOLVED]
  );
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].raw_name, "Persona Desconocida XYZ");
  assert.equal(res.rows[0].resolution_status, "UNRESOLVED_FREE_TEXT");
});

// HOTFIX de integridad de datos FieldBeat - regresión real: antes, TODA
// selección estructurada (nunca "OTROS") caía a UNRESOLVED_UNKNOWN_TOKEN
// porque quality.fieldbeat_engineer_roster partía possible_values por '|'
// en vez de ',' (0 de las 3773 filas reales de este campo contienen '|').
test("quality.fieldbeat_report_participants: adicional ESTRUCTURADO (Gonzalo Lopez, sin 'OTROS') resuelve RESOLVED_ROSTER_MATCH, nunca UNRESOLVED_UNKNOWN_TOKEN", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT raw_name, normalized_name, role, source_type, resolution_status, is_primary
     FROM quality.fieldbeat_report_participants WHERE fieldbeat_task_id = $1 ORDER BY is_primary DESC, raw_name`,
    [REPORT_STRUCTURED_ADDITIONAL]
  );
  const rows = res.rows;
  assert.equal(rows.length, 2, "Manuel Reyes (principal) + Gonzalo Lopez (adicional), Manuel Reyes NUNCA duplicado");

  const primary = rows.find(r => r.is_primary);
  assert.equal(primary.normalized_name, "MANUEL REYES");

  const additional = rows.find(r => !r.is_primary);
  assert.ok(additional, "Gonzalo Lopez debe aparecer como participante adicional");
  assert.equal(additional.raw_name, "GONZALO LOPEZ");
  assert.equal(additional.role, "ADDITIONAL_STRUCTURED");
  assert.equal(additional.source_type, "REPORT_FIELD_STRUCTURED_VALUE");
  assert.equal(additional.resolution_status, "RESOLVED_ROSTER_MATCH", "una selección estructurada real del roster NUNCA debe quedar como no resuelta");
});

test("quality.fieldbeat_report_labor_summary: reporte 3453-like usa 130 min REALES (declarados), nunca 120 (estimado)", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT actual_report_duration_minutes, actual_duration_source, scheduled_estimate_minutes, participant_count, total_labor_minutes, individual_time_available
     FROM quality.fieldbeat_report_labor_summary WHERE fieldbeat_task_id = $1`,
    [REPORT_3453_LIKE]
  );
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  assert.equal(Number(row.actual_report_duration_minutes), 130, "duración real = intervalo declarado 09:50->12:00, nunca la estimación de 120");
  assert.equal(row.actual_duration_source, "FORM_DECLARED_INTERVAL");
  assert.equal(Number(row.scheduled_estimate_minutes), 120, "la estimación de agenda se conserva por separado, nunca se descarta ni se confunde con la real");
  assert.equal(Number(row.participant_count), 2);
  assert.equal(Number(row.total_labor_minutes), 260, "130 min x 2 participantes = 260 minutos-persona");
  assert.equal(row.individual_time_available, false);
});

test("quality.fieldbeat_report_labor_summary: sin intervalo declarado ni transición validada -> duración real NULL, nunca rellenada con la estimación", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT actual_report_duration_minutes, actual_duration_source, scheduled_estimate_minutes, total_labor_minutes
     FROM quality.fieldbeat_report_labor_summary WHERE fieldbeat_task_id = $1`,
    [REPORT_MINIMAL]
  );
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  assert.equal(row.actual_report_duration_minutes, null);
  assert.equal(row.actual_duration_source, "UNAVAILABLE");
  assert.equal(row.scheduled_estimate_minutes, null, "905002 no tiene duration_minutes seteado (NULL) en este fixture");
  assert.equal(row.total_labor_minutes, null, "nunca se rellena multiplicando una estimación inexistente por participantes");
});

test("quality.fieldbeat_report_part_occurrences: CX1551G/Thyratron conservan raw_part_number visible y sourceComment, declarationStatus siempre DECLARED_IN_REPORT", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT raw_part_identifier, part_name, quantity, origin_location, origin_comment, declaration_status, catalog_match_status, matched_sku
     FROM quality.fieldbeat_report_part_occurrences WHERE fieldbeat_task_id = $1`,
    [REPORT_3453_LIKE]
  );
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  assert.equal(row.raw_part_identifier, "CX1551G");
  assert.equal(row.part_name, "Thyratron");
  assert.equal(Number(row.quantity), 1);
  assert.equal(row.origin_location, "Otros (Comente)");
  assert.equal(row.origin_comment, "Repuesto proporcionado por el cliente");
  assert.equal(row.declaration_status, "DECLARED_IN_REPORT");
  assert.equal(row.catalog_match_status, "NO_MATCH");
  assert.equal(row.matched_sku, null, "sin match validado, nunca se inventa un SKU");
});

// HOTFIX de integridad de datos FieldBeat (Stage 7 - propagación de
// participantes a filtros) - caso de aceptación EXACTO exigido por el plan
// aprobado: "Alexis encuentra el reporte con 'any'; NO con 'primary'; SÍ
// con 'additional'; Manuel lo encuentra con 'primary'; el reporte se
// cuenta una sola vez en totales globales". Ejercita el endpoint real
// /api/dashboard/fieldbeat/reports (GET real, no una re-implementación).
test("GET /api/dashboard/fieldbeat/reports: technicianRole distingue responsable principal (Manuel) de adicional (Alexis) - caso 3453-like", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/route.ts");

  const findsReport = async (params: Record<string, string>) => {
    const body = await (await GET(reportsReq({ reportsView: "all", ...params }))).json();
    const ids = (body.rows as Array<{ fieldbeatTaskId: string }>).map(r => r.fieldbeatTaskId);
    return { ids, totalRows: body.totalRows as number };
  };

  const manuelPrimary = await findsReport({ technician: "Manuel Reyes", technicianRole: "primary" });
  assert.ok(manuelPrimary.ids.includes(String(REPORT_3453_LIKE)), "Manuel Reyes (responsable principal) debe encontrarse con technicianRole=primary");

  const alexisPrimary = await findsReport({ technician: "Alexis Acevedo", technicianRole: "primary" });
  assert.ok(!alexisPrimary.ids.includes(String(REPORT_3453_LIKE)), "Alexis Acevedo (adicional) NUNCA debe encontrarse con technicianRole=primary");

  const alexisAdditional = await findsReport({ technician: "Alexis Acevedo", technicianRole: "additional" });
  assert.ok(alexisAdditional.ids.includes(String(REPORT_3453_LIKE)), "Alexis Acevedo debe encontrarse con technicianRole=additional");

  const alexisAny = await findsReport({ technician: "Alexis Acevedo", technicianRole: "any" });
  assert.ok(alexisAny.ids.includes(String(REPORT_3453_LIKE)), "Alexis Acevedo debe encontrarse con technicianRole=any");

  // El reporte se cuenta UNA sola vez en totales globales, sin importar
  // cuántos participantes tenga - nunca se duplica por el join a participantes.
  const occurrences = alexisAny.ids.filter(id => id === String(REPORT_3453_LIKE));
  assert.equal(occurrences.length, 1, "el reporte 3453-like nunca debe aparecer duplicado en la lista, aunque tenga 2 participantes");
});

test("manual_review.fieldbeat_engineer_identity_map: mreyes está sembrado como AUTO_EVIDENCED, nunca descrito como verificación manual", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT canonical_display_name, verification_method, confidence, verified_at
     FROM manual_review.fieldbeat_engineer_identity_map WHERE source_type = 'ASSIGNED_TO_USERNAME' AND source_value_normalized = 'mreyes'`
  );
  assert.equal(res.rows.length, 1);
  // "MANUEL REYES" (mayúsculas) es el token ORIGINAL tal como aparece en el
  // roster/dropdown real de FieldBeat (posible_values) - nunca se
  // reconstruye un display name en title-case, se preserva la grafía real.
  assert.equal(res.rows[0].canonical_display_name, "MANUEL REYES");
  assert.equal(res.rows[0].verification_method, "AUTO_EVIDENCED");
  assert.equal(res.rows[0].verified_at, null, "AUTO_EVIDENCED nunca se describe como verificado manualmente");
});

// IMPORTANTE: este test corre AL FINAL a propósito - muta permanentemente
// la fila 'mreyes' (simula una corrección humana), lo que romperia el
// test anterior (que verifica el estado AUTO_EVIDENCED prístino de la
// siembra) si corriera antes.
test("manual_review.fieldbeat_engineer_identity_map: reaplicar la migración NUNCA sobrescribe una fila corregida manualmente", { skip: !TEST_DB_URL }, async () => {
  // Simula una corrección humana posterior a la siembra inicial: cambia
  // canonical_display_name y marca verification_method='MANUALLY_VERIFIED'
  // con verified_at/verified_by reales.
  await adminPool.query(
    `UPDATE manual_review.fieldbeat_engineer_identity_map
     SET canonical_display_name = 'Manuel Reyes Irrazaval (corregido a mano)',
         verification_method = 'MANUALLY_VERIFIED',
         verified_at = now(),
         verified_by = 'qa-manual-review'
     WHERE source_type = 'ASSIGNED_TO_USERNAME' AND source_value_normalized = 'mreyes'`
  );

  // Reaplica la migración COMPLETA (mismo archivo real, no una copia) -
  // su INSERT ... ON CONFLICT DO NOTHING para 'mreyes' NUNCA debe revertir
  // la corrección manual de arriba.
  const migrationSql = fs.readFileSync(MIGRATION_088_PATH, "utf8");
  await adminPool.query(migrationSql);

  const res = await adminPool.query(
    `SELECT canonical_display_name, verification_method, verified_by
     FROM manual_review.fieldbeat_engineer_identity_map WHERE source_type = 'ASSIGNED_TO_USERNAME' AND source_value_normalized = 'mreyes'`
  );
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].canonical_display_name, "Manuel Reyes Irrazaval (corregido a mano)", "la corrección manual NO debe revertirse al reaplicar la migración");
  assert.equal(res.rows[0].verification_method, "MANUALLY_VERIFIED");
  assert.equal(res.rows[0].verified_by, "qa-manual-review");
});

// Depende DIRECTAMENTE de la mutación del test anterior (mreyes ahora
// MANUALLY_VERIFIED) - por eso corre inmediatamente después, nunca antes.
// "Evidencia automática ≠ verificación manual" (§ mapa de identidad del
// plan): el responsable principal debe distinguir explícitamente cuándo su
// identidad fue confirmada por un humano vs. solo propuesta por evidencia
// automática - nunca presentar ambos casos con la misma etiqueta.
test("quality.fieldbeat_report_participants: responsable principal con identidad MANUALLY_VERIFIED se resuelve como RESOLVED_CURATED_IDENTITY (nunca RESOLVED_ASSIGNED_TO genérico)", { skip: !TEST_DB_URL }, async () => {
  const res = await adminPool.query(
    `SELECT raw_name, normalized_name, resolution_status FROM quality.fieldbeat_report_participants WHERE fieldbeat_task_id = $1 AND is_primary = true`,
    [REPORT_3453_LIKE]
  );
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].resolution_status, "RESOLVED_CURATED_IDENTITY", "identidad confirmada por un humano (MANUALLY_VERIFIED) debe distinguirse de una fila solo AUTO_EVIDENCED");
});
