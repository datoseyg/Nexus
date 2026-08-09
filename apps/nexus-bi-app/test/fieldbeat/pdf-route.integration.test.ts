// Pruebas de integración de Phase 6 - "PDF NEXUS" (export server-side del
// detalle maestro de un reporte FieldBeat) - mismo mecanismo de Postgres
// desechable que test/fieldbeat/quality-api.integration.test.ts (ver ese
// archivo para el contexto completo del incidente ETAPA SAFETY-1).
//
// Rango de fieldbeat_task_id propio (903001-903002) y client_key con
// prefijo "PDFNEXUS|" - disjunto de 900001-900020/901001-901026 (quality/
// paginación) y de 902001-902003 (open-route) y de cualquier
// fieldbeat_task_id real (máximo observado en la reconciliación local:
// 3777).
//
// Este archivo NO reverifica la clasificación de calidad (eso ya lo cubre
// quality-api.integration.test.ts) - se enfoca en lo específico del PDF:
// formato real (firma %PDF-), headers, multipágina, y que nunca se cae
// con colecciones vacías.
import { test, before, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import pg from "pg";
import { NextRequest } from "next/server.js";
import { assertDisposableTarget, printConnectionPreflight } from "../../../../src/lib/db-safety.js";
import { setAuthorizationProviderForTests } from "../../lib/auth/authorization.ts";

const TEST_DB_URL = process.env.AFTER_HOURS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.AFTER_HOURS_TEST_RUN_ID;
const SUITE_ID = "fieldbeat-pdf-route-phase6-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL = TEST_DB_URL;
  process.env.DATABASE_SSL_MODE = "disable";
}

const { Pool } = pg;
let adminPool: pg.Pool;

const CLIENT_KEY = "PDFNEXUS|66.666.666-6|Cliente Fixture PDF Ñuñoa";
const CLIENT_NAME = "Cliente Fixture PDF Ñuñoa";
const ID_MIN = 903001;
const ID_MAX = 903002;
const RICH_ID = 903001; // muchos tickets/repuestos/inconsistencias -> fuerza multipágina
const MINIMAL_ID = 903002; // todo vacío/null -> nunca debe fallar
const NONEXISTENT_ID = "999999997";

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function pdfReq(id: string) {
  return { params: Promise.resolve({ id }) };
}

// pdfkit comprime los content streams con /FlateDecode por defecto Y
// codifica el texto como PDF hex strings (<...>) dentro de arreglos TJ
// intercalados con números de kerning - p.ej. "Reporte FieldBeat #900005"
// sale como `[<5265706f72> -20 <7465204669656c64426561742023393030303035>] TJ`,
// nunca como un string literal "(Reporte...)" contiguo (verificado
// directamente inspeccionando un PDF de muestra). Reconstruir el texto
// renderizado requiere: 1) inflar cada stream `stream...endstream`, 2)
// extraer cada hex string `<...>`, 3) decodificarla byte a byte como
// latin1 (WinAnsiEncoding coincide con Latin-1 en el rango 0xA0-0xFF, que
// cubre á/é/í/ó/ú/ñ/Ñ) y concatenar en orden. Los checks de ESTRUCTURA
// (firma %PDF-, endobj/startxref, conteo de objetos /Type /Page, ausencia
// de "<html") sí operan sobre los bytes crudos - esos tokens viven en la
// sintaxis plana de objetos PDF, nunca dentro de un stream comprimido.
function extractRenderedPdfText(buffer: Buffer): string {
  const latin1 = buffer.toString("latin1");
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let combined = "";
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(latin1)) !== null) {
    let inflated: string;
    try {
      inflated = zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      // stream no comprimido con Flate (p.ej. una imagen embebida) - se
      // ignora para esta búsqueda de texto, no es un error real.
      continue;
    }
    const hexStringPattern = /<([0-9a-fA-F]+)>/g;
    let hex: RegExpExecArray | null;
    while ((hex = hexStringPattern.exec(inflated)) !== null) {
      const bytes = hex[1];
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        combined += String.fromCharCode(parseInt(bytes.substr(i, 2), 16));
      }
    }
  }
  return combined;
}

function asGerencia() {
  setAuthorizationProviderForTests({
    async getUser() {
      return { user: { id: "fieldbeat-pdf-route-integration", app_metadata: { nexus_role: "gerencia" } }, error: null };
    }
  });
}

async function insertTask(row: { id: number; assignedTo?: string | null; description?: string | null; startTime?: string; lastTransitionAt?: string; durationMinutes?: number | null }) {
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_tasks
       (fieldbeat_task_id, client_key, assigned_to, task_type, state, description, start_time, last_transition_at, duration_minutes, created_at, created_in)
     VALUES ($1,$2,$3,'PM','FINISHED',$4,$5,$6,$7,'2026-03-10T13:00:00Z','APK')`,
    [
      row.id,
      CLIENT_KEY,
      row.assignedTo === undefined ? "Técnico Fixture Ñuñoz" : row.assignedTo,
      row.description ?? null,
      row.startTime ?? "2026-03-10T14:00:00Z",
      row.lastTransitionAt ?? "2026-03-10T15:00:00Z",
      row.durationMinutes === undefined ? 45 : row.durationMinutes
    ]
  );
}

async function insertMartRow(row: { id: number; equipmentInternalIds?: string; technicianNames?: string }) {
  await adminPool.query(
    `INSERT INTO marts.fieldbeat_report_dolibarr_operational_view
       (fieldbeat_task_id, fieldbeat_task_date, client_key, client_name, task_type, task_state, technician_names, equipment_internal_ids, used_parts_count, report_quality_status)
     VALUES ($1,'2026-03-10T14:00:00Z',$2,$3,'PM','FINISHED',$4,$5,0,'NO_USED_PARTS')`,
    [row.id, CLIENT_KEY, CLIENT_NAME, row.technicianNames === undefined ? "Técnico Fixture Ñuñoz" : row.technicianNames, row.equipmentInternalIds ?? ""]
  );
}

async function insertPartLine(row: { taskId: number; usedPartId: string; matchStatus: string }) {
  await adminPool.query(
    `INSERT INTO marts.used_parts_dolibarr_match (used_part_id, fieldbeat_task_id, part_name, raw_part_identifier, normalized_part_identifier, match_status)
     VALUES ($1,$2,'Repuesto fixture con acentos: válvula de succión',$3,$4,$5)`,
    [row.usedPartId, row.taskId, row.usedPartId, row.usedPartId.toLowerCase(), row.matchStatus]
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
  await adminPool.query(`DELETE FROM marts.ticket_fieldbeat_report_detail WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);
  await adminPool.query(`DELETE FROM processed.fieldbeat_tasks WHERE fieldbeat_task_id BETWEEN $1 AND $2`, [ID_MIN, ID_MAX]);

  // 903001: reporte "rico" - descripción con 2 candidatos de equipo
  // (ambiguo), cronología imposible, y varios tickets/repuestos - fuerza
  // más de 1 página real en el PDF.
  await adminPool.query(
    `INSERT INTO processed.fieldbeat_equipments (equipment_key, internal_id, client_key, equipment_type) VALUES
       ('pdfnexus-eq-901', 'EQ-901', $1, 'BOMBA'),
       ('pdfnexus-eq-902', 'EQ-902', $1, 'BOMBA')`,
    [CLIENT_KEY]
  );
  await insertTask({
    id: RICH_ID,
    description: "Revisión cruzada EQ-901 y EQ-902 en la misma visita, con notas en español: mantención de válvula y calibración de sensor de presión",
    startTime: "2026-03-10T15:00:00Z",
    lastTransitionAt: "2026-03-10T14:00:00Z",
    durationMinutes: 0
  });
  await insertMartRow({ id: RICH_ID, equipmentInternalIds: "" });
  for (let i = 0; i < 6; i++) {
    await adminPool.query(
      `INSERT INTO marts.ticket_fieldbeat_report_detail (bridge_id, zendesk_ticket_id, fieldbeat_task_id, link_method, confidence)
       VALUES ($1,$2,$3,'exact',100)`,
      [`pdfnexus-bridge-${i}`, 600000 + i, RICH_ID]
    );
  }
  for (let i = 0; i < 6; i++) {
    await insertPartLine({ taskId: RICH_ID, usedPartId: `PDFNEXUS-PART-${i}`, matchStatus: i % 2 === 0 ? "MATCHED" : "NO_MATCH" });
  }

  // 903002: reporte "mínimo" - sin técnico, sin equipo, sin tickets, sin
  // repuestos, sin inconsistencias (limpio) - el PDF nunca debe fallar
  // aunque TODAS las colecciones estén vacías.
  await insertTask({ id: MINIMAL_ID, assignedTo: null });
  await insertMartRow({ id: MINIMAL_ID, equipmentInternalIds: "", technicianNames: "" });
});

afterAll(async () => {
  if (adminPool) await adminPool.end();
  setAuthorizationProviderForTests(null);
});

test("pdf: 401 sin sesión", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  setAuthorizationProviderForTests({ async getUser() { return { user: null, error: null }; } });
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${RICH_ID}/pdf`), pdfReq(String(RICH_ID)));
  assert.equal(res.status, 401);
});

test("pdf: 403 con rol no autorizado", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  setAuthorizationProviderForTests({
    async getUser() { return { user: { id: "x", app_metadata: { nexus_role: "tecnico" } }, error: null }; }
  });
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${RICH_ID}/pdf`), pdfReq(String(RICH_ID)));
  assert.equal(res.status, 403);
});

test("pdf: 400 con ID inválido (decimal/negativo/cero/texto)", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  for (const badId of ["0", "-5", "3.5", "abc", "007"]) {
    const res = await GET(req(`/api/dashboard/fieldbeat/reports/${badId}/pdf`), pdfReq(badId));
    assert.equal(res.status, 400, `ID "${badId}" debería ser 400`);
  }
});

test("pdf: 404 cuando el reporte no existe, nunca 500", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${NONEXISTENT_ID}/pdf`), pdfReq(NONEXISTENT_ID));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, "NOT_FOUND");
});

test("pdf: 200 con Content-Type/Content-Disposition/Cache-Control/X-Content-Type-Options correctos", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${RICH_ID}/pdf`), pdfReq(String(RICH_ID)));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(res.headers.get("content-disposition"), `attachment; filename="nexus_fieldbeat_reporte_${RICH_ID}.pdf"`);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("pdf: el cuerpo es un PDF real (firma %PDF-), no HTML disfrazado, no vacío", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${RICH_ID}/pdf`), pdfReq(String(RICH_ID)));
  const buffer = Buffer.from(await res.arrayBuffer());

  assert.ok(buffer.length > 1000, "el PDF no debe estar vacío ni ser un stub trivial");
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-", "debe tener la firma real de un PDF");

  const text = buffer.toString("latin1");
  assert.ok(text.includes("endobj") && text.includes("startxref"), "debe tener estructura real de objetos PDF");
  assert.ok(!text.toLowerCase().includes("<html"), "nunca debe ser HTML renombrado como .pdf");
});

test("pdf: el reporte 'rico' (6 tickets, 6 repuestos, equipo ambiguo, cronología imposible) produce más de 1 página real", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${RICH_ID}/pdf`), pdfReq(String(RICH_ID)));
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString("latin1");

  // Cada página real es un objeto PDF con /Type /Page (sin la "s" de
  // /Pages, el nodo padre del árbol de páginas) - contar sin duplicar por
  // /Type /Pages es la forma robusta de verificar "más de 1 página" sin
  // parsear el PDF con una librería adicional.
  const pageObjectMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
  assert.ok(pageObjectMatches.length >= 2, `se esperaban >= 2 páginas reales, hubo ${pageObjectMatches.length}`);

  // Nunca 2 páginas fantasma en blanco al final (bug real encontrado en
  // desarrollo: escribir el pie de página dentro del margen inferior sin
  // anular ese margen primero hacía que pdfkit agregara páginas extra en
  // blanco) - el conteo de "Página X de Y" en el texto RENDERIZADO
  // (streams inflados + hex strings decodificadas, ver
  // extractRenderedPdfText) debe coincidir EXACTAMENTE con la cantidad
  // real de objetos /Page.
  const renderedText = extractRenderedPdfText(buffer);
  const footerMatches = renderedText.match(/P.gina \d+ de \d+/g) ?? [];
  assert.equal(footerMatches.length, pageObjectMatches.length, "el pie de página debe aparecer en TODAS las páginas reales, sin páginas fantasma extra");
});

test("pdf: caracteres en español (á/é/í/ó/ú/ñ) del reporte 'rico' aparecen en el PDF, no se pierden ni se corrompen", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${RICH_ID}/pdf`), pdfReq(String(RICH_ID)));
  const buffer = Buffer.from(await res.arrayBuffer());

  // El texto va codificado como PDF hex strings dentro de streams
  // comprimidos (FlateDecode) - hay que reconstruirlo (ver
  // extractRenderedPdfText) antes de poder buscar los caracteres
  // acentuados realmente renderizados.
  const renderedText = extractRenderedPdfText(buffer);
  assert.ok(
    renderedText.includes("Ñuñoz") || renderedText.includes("Fixture PDF") || renderedText.includes("PDF Ñuñoa"),
    "el nombre de cliente/técnico con ñ debe aparecer en el texto renderizado del PDF"
  );
});

test("pdf: el reporte 'mínimo' (sin técnico/equipo/tickets/repuestos/inconsistencias) genera un PDF válido, nunca falla por colecciones vacías", { skip: !TEST_DB_URL }, async () => {
  const { GET } = await import("../../app/api/dashboard/fieldbeat/reports/[id]/pdf/route.ts");
  asGerencia();
  const res = await GET(req(`/api/dashboard/fieldbeat/reports/${MINIMAL_ID}/pdf`), pdfReq(String(MINIMAL_ID)));
  assert.equal(res.status, 200);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(buffer.length > 500);
});
