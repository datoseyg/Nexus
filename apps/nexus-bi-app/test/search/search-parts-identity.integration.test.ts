// HOTFIX de integridad de datos FieldBeat (Stage 9) - prueba de integración
// del defecto REAL encontrado en lib/search-sql.ts: antes, un repuesto SIN
// dolibarr_ref NI raw_part_identifier/normalized_part_identifier (declarado
// solo con un nombre genérico, ej. "Filtro") producía una expresión de
// agrupación NULL - Postgres agrupa TODOS los NULL de un GROUP BY como un
// solo grupo, así que dos "Filtro" completamente distintos (reportes/
// clientes/cantidades distintos, sin ningún código) se fusionaban en una
// sola fila fantasma. Verificado contra Postgres real, no solo razonado.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "search-parts-identity-hotfix-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_KEY_PREFIX = "SEARCHFIX";
const ID_MIN = 906001;
const ID_MAX = 906004;

// 906001/906002: dos ocurrencias "Filtro" SIN código, en reportes/clientes/
// cantidades distintos - caso central de la regresión.
const REPORT_FILTRO_A = 906001;
const REPORT_FILTRO_B = 906002;
// 906003: repuesto CON código crudo (raw_part_identifier), sin match de catálogo.
const REPORT_RAW_CODE = 906003;
// 906004: repuesto CON match de catálogo Dolibarr validado.
const REPORT_CATALOG_MATCH = 906004;

function req(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "search-parts-identity-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

async function insertPartFixture(
  pool: pg.Pool,
  row: { taskId: number; clientName: string; usedPartId: string; partName: string; quantity: number; rawPartIdentifier?: string | null; normalizedPartIdentifier?: string | null; dolibarrRef?: string | null }
) {
  await pool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
       (fieldbeat_task_id, fieldbeat_task_date, client_key, client_name, task_type, task_state, technician_names, equipment_internal_ids, used_parts_count, report_quality_status)
     VALUES ($1,'2026-02-01T12:00:00Z',$2,$3,'CORRECTIVA','FINISHED','tech1','',1,'OK')`,
    [row.taskId, `${CLIENT_KEY_PREFIX}|${row.taskId}`, row.clientName]
  );
  await pool.query(
    `INSERT INTO processed.fieldbeat_used_parts (used_part_id, fieldbeat_task_id, part_number, part_name, quantity, raw_original_part_number, raw_original_part_name, origin_location, needs_manual_review)
     VALUES ($1,$2,$3,$4,$5,$3,$4,'',false)`,
    [row.usedPartId, row.taskId, row.rawPartIdentifier ?? null, row.partName, row.quantity]
  );
  await pool.query(
    `INSERT INTO marts.used_parts_dolibarr_match
       (used_part_id, fieldbeat_task_id, part_name, dolibarr_ref, raw_part_identifier, normalized_part_identifier, match_method, match_confidence, match_status, needs_manual_review)
     VALUES ($1,$2,$3,$4,$5,$6,'NONE',0,$7,true)`,
    [
      row.usedPartId,
      row.taskId,
      row.partName,
      row.dolibarrRef ?? null,
      row.rawPartIdentifier ?? null,
      row.normalizedPartIdentifier ?? null,
      row.dolibarrRef ? "MATCHED" : "NO_MATCH"
    ]
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

  await adminPool.query(`DELETE FROM marts.used_parts_dolibarr_match WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_used_parts WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);

  await insertPartFixture(adminPool, { taskId: REPORT_FILTRO_A, clientName: "Cliente Filtro A", usedPartId: `${REPORT_FILTRO_A}|1|0|`, partName: "Filtro Hotfix Search", quantity: 3 });
  await insertPartFixture(adminPool, { taskId: REPORT_FILTRO_B, clientName: "Cliente Filtro B", usedPartId: `${REPORT_FILTRO_B}|1|0|`, partName: "Filtro Hotfix Search", quantity: 7 });
  await insertPartFixture(adminPool, {
    taskId: REPORT_RAW_CODE,
    clientName: "Cliente Codigo Crudo",
    usedPartId: `${REPORT_RAW_CODE}|1|0|HOTFIXCODE1`,
    partName: "Repuesto Con Codigo",
    quantity: 2,
    rawPartIdentifier: "HOTFIXCODE1",
    normalizedPartIdentifier: "hotfixcode1"
  });
  await insertPartFixture(adminPool, {
    taskId: REPORT_CATALOG_MATCH,
    clientName: "Cliente Catalogo",
    usedPartId: `${REPORT_CATALOG_MATCH}|1|0|HOTFIXREF1`,
    partName: "Repuesto Con Match",
    quantity: 5,
    rawPartIdentifier: "HOTFIXREF1",
    normalizedPartIdentifier: "hotfixref1",
    dolibarrRef: "HOTFIXREF1"
  });
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("GET /api/search parts: dos ocurrencias 'Filtro' SIN código NUNCA se fusionan en un solo resultado", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/search/route.ts");
  const body = await (await GET(req("/api/search", { q: "Filtro Hotfix Search", entity: "parts" }))).json();

  const rows = body.groups.parts as Array<{ key: string; quantityConsumed: number; reportCount: number }>;
  assert.ok(rows.length >= 2, `se esperaban al menos 2 filas separadas, se obtuvieron ${rows.length}`);

  const keys = rows.map(r => r.key);
  assert.equal(new Set(keys).size, keys.length, "cada ocurrencia sin código debe tener una key ÚNICA, nunca compartida");
  for (const key of keys) {
    assert.match(key, /^raw-occurrence:/, "sin código real, la identidad debe ser raw-occurrence:<used_part_id>, nunca una key genérica compartida");
  }

  // Cada fila refleja SOLO su propia cantidad/reporte - nunca una mezcla de ambas.
  const quantities = rows.map(r => r.quantityConsumed).sort((a, b) => a - b);
  assert.ok(quantities.includes(3), "la ocurrencia de 906001 (cantidad 3) debe aparecer intacta, nunca sumada con la otra");
  assert.ok(quantities.includes(7), "la ocurrencia de 906002 (cantidad 7) debe aparecer intacta, nunca sumada con la otra");
  for (const r of rows) {
    assert.equal(r.reportCount, 1, "cada ocurrencia sin código representa 1 solo reporte real, nunca 2 fusionados");
  }
});

test("GET /api/search/detail parts: raw-occurrence resuelve a la ocurrencia EXACTA, nunca a una mezcla de otras sin código", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET: getSearch } = await import("../../app/api/search/route.ts");
  const searchBody = await (await getSearch(req("/api/search", { q: "Filtro Hotfix Search", entity: "parts" }))).json();
  const rows = searchBody.groups.parts as Array<{ key: string; quantityConsumed: number }>;
  const rowA = rows.find(r => r.quantityConsumed === 3);
  assert.ok(rowA, "debe existir la fila de cantidad 3 (906001)");

  const { GET: getDetail } = await import("../../app/api/search/detail/route.ts");
  const detailBody = await (await getDetail(req("/api/search/detail", { entity: "parts", key: rowA!.key }))).json();
  assert.equal(detailBody.entity, "parts");
  assert.equal(detailBody.summary.quantityConsumed, 3, "el detalle debe reflejar EXACTAMENTE la ocurrencia solicitada, nunca la suma con la otra 'Filtro'");
  assert.equal(detailBody.recentUsages.length, 1);
  assert.equal(detailBody.recentUsages[0].clientName, "Cliente Filtro A");
});

test("GET /api/search parts: repuesto CON código crudo usa identidad raw-part:<código normalizado>", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/search/route.ts");
  const body = await (await GET(req("/api/search", { q: "HOTFIXCODE1", entity: "parts" }))).json();
  const rows = body.groups.parts as Array<{ key: string }>;
  assert.equal(rows.length, 1);
  // La key preserva el valor de normalized_part_identifier TAL COMO está
  // almacenado (este fixture lo insertó en minúscula) - nunca reconstruye
  // un casing propio, mismo principio que shapePartOccurrence().
  assert.equal(rows[0].key, "raw-part:hotfixcode1");
});

test("GET /api/search parts: repuesto CON match de catálogo Dolibarr usa identidad catalog-product:<ref>", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/search/route.ts");
  const body = await (await GET(req("/api/search", { q: "HOTFIXREF1", entity: "parts" }))).json();
  const rows = body.groups.parts as Array<{ key: string; sku: string | null }>;
  const catalogRow = rows.find(r => r.sku === "HOTFIXREF1");
  assert.ok(catalogRow, "debe existir la fila con match de catálogo");
  assert.equal(catalogRow!.key, "catalog-product:HOTFIXREF1");
});

test("GET /api/search/detail parts: clave con formato inválido (sin prefijo reconocido) nunca se interpola, produce 400/500 controlado", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/search/detail/route.ts");
  const res = await GET(req("/api/search/detail", { entity: "parts", key: "bogus-no-prefix" }));
  assert.notEqual(res.status, 200, "una key sin prefijo reconocido nunca debe resolver como si fuera válida");
});

// HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - regresión
// real que casi se cuela: "reports" sigue siendo un SearchEntity válido
// (usado para pestañas/conteos), así que parseDetailParams() no lo rechaza
// por sí solo - sin un rechazo EXPLÍCITO en la ruta, entity=reports caía
// silenciosamente al catch-all de "parts" (parsePartsKey lanzaría sobre
// cualquier fieldbeatTaskId real, ya que no tiene el prefijo esperado).
test("GET /api/search/detail: entity=reports se rechaza explícitamente (400), NUNCA cae al catch-all de parts", { skip: !TEST_DB_URL }, async () => {
  asGerencia();
  const { GET } = await import("../../app/api/search/detail/route.ts");
  const res = await GET(req("/api/search/detail", { entity: "reports", key: String(REPORT_FILTRO_A) }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "ENTITY_RETIRED");
});
