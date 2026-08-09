import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReportsPageSize,
  parseReportsPage,
  parseReportsView,
  parseReportsSort,
  parseReportsDirection,
  parseReportsSearch,
  buildReportsBaseCte,
  buildReportsListingQuery,
  buildReportsExportQuery,
  shapeReportRow,
  isExportOverLimit,
  MAX_EXPORT_ROWS,
  DEFAULT_REPORTS_PAGE_SIZE
} from "../../lib/fieldbeat-reports-queries.ts";

test("parseReportsPageSize: allowlist estricta (25/50/100), cualquier otro valor vuelve al default", () => {
  assert.equal(parseReportsPageSize("25"), 25);
  assert.equal(parseReportsPageSize("50"), 50);
  assert.equal(parseReportsPageSize("100"), 100);
  assert.equal(parseReportsPageSize("200"), DEFAULT_REPORTS_PAGE_SIZE, "200 no está en el allowlist");
  assert.equal(parseReportsPageSize("0"), DEFAULT_REPORTS_PAGE_SIZE);
  assert.equal(parseReportsPageSize("bogus"), DEFAULT_REPORTS_PAGE_SIZE);
  assert.equal(parseReportsPageSize(null), DEFAULT_REPORTS_PAGE_SIZE);
});

test("parseReportsPage: entero >=1, cualquier otra cosa vuelve a 1", () => {
  assert.equal(parseReportsPage("3"), 3);
  assert.equal(parseReportsPage("0"), 1);
  assert.equal(parseReportsPage("-5"), 1);
  assert.equal(parseReportsPage("1.5"), 1, "no entero -> default");
  assert.equal(parseReportsPage(null), 1);
});

test("parseReportsView: solo 'all' activa la vista completa, cualquier otro valor (incluido ausente) es 'exceptions'", () => {
  assert.equal(parseReportsView("all"), "all");
  assert.equal(parseReportsView("exceptions"), "exceptions");
  assert.equal(parseReportsView("bogus"), "exceptions");
  assert.equal(parseReportsView(null), "exceptions");
});

test("parseReportsSort: allowlist de 6 claves, valor desconocido vuelve a 'date'", () => {
  for (const key of ["date", "severity", "client", "technician", "taskType", "id"]) {
    assert.equal(parseReportsSort(key), key);
  }
  assert.equal(parseReportsSort("bogus"), "date");
  assert.equal(parseReportsSort(null), "date");
});

test("parseReportsDirection: solo 'asc' activa ascendente, todo lo demás es 'desc'", () => {
  assert.equal(parseReportsDirection("asc"), "asc");
  assert.equal(parseReportsDirection("desc"), "desc");
  assert.equal(parseReportsDirection("bogus"), "desc");
  assert.equal(parseReportsDirection(null), "desc");
});

test("parseReportsSearch: recorta a solo dígitos, string vacío tras recortar -> null", () => {
  assert.equal(parseReportsSearch("900005"), "900005");
  assert.equal(parseReportsSearch(" 9000 "), "9000");
  assert.equal(parseReportsSearch("abc-900005-def"), "900005", "caracteres no numéricos se descartan, nunca se interpolan en SQL");
  assert.equal(parseReportsSearch("abc"), null);
  assert.equal(parseReportsSearch(""), null);
  assert.equal(parseReportsSearch(null), null);
  assert.equal(parseReportsSearch("1".repeat(100))?.length, 40, "tope defensivo de longitud");
});

const BASE_OPTIONS = { filters: {}, view: "exceptions" as const, search: null, sort: "date" as const, direction: "desc" as const };

// Regresión de rendimiento (ver informe): el filtro de "exceptions" ahora
// vive en el MISMO WHERE que el resto de las condiciones de `base` (sobre
// `pi.code`, la expresión fuente - el alias `primary_code` no existe
// todavía en ese nivel de SELECT), nunca en una capa separada aplicada
// DESPUÉS del enriquecimiento caro.
test("buildReportsBaseCte: vista 'exceptions' agrega pi.code IS NOT NULL al WHERE de base; 'all' no filtra por inconsistencia", () => {
  const exceptions = buildReportsBaseCte(BASE_OPTIONS);
  assert.match(exceptions.cteSql, /WHERE.*pi\.code IS NOT NULL/s);

  const all = buildReportsBaseCte({ ...BASE_OPTIONS, view: "all" });
  assert.doesNotMatch(all.cteSql, /pi\.code IS NOT NULL/);
});

test("buildReportsBaseCte: búsqueda por ID agrega condición exacta-o-prefijo parametrizada, nunca interpolada", () => {
  const { cteSql, params } = buildReportsBaseCte({ ...BASE_OPTIONS, search: "9000" });
  assert.match(cteSql, /CAST\(u\.fieldbeat_task_id AS TEXT\) = \$\d+ OR CAST\(u\.fieldbeat_task_id AS TEXT\) LIKE \$\d+/);
  assert.ok(params.includes("9000"));
  assert.ok(params.includes("9000%"));
});

test("buildReportsBaseCte: sort/direction se reflejan en ORDER BY con empate estable por id", () => {
  const { orderBySql } = buildReportsBaseCte({ ...BASE_OPTIONS, sort: "severity", direction: "asc" });
  assert.match(orderBySql, /ORDER BY severity_rank ASC NULLS LAST, fieldbeat_task_id ASC/);
});

test("buildReportsBaseCte: filtros comunes (client/severity/etc.) se delegan a buildFieldbeatQualityConditions, nunca reimplementados acá", () => {
  const { cteSql, params } = buildReportsBaseCte({ ...BASE_OPTIONS, filters: { client: "ACME", severity: "Alta" } });
  assert.match(cteSql, /u\.client_name = \$\d+/);
  assert.ok(params.includes("ACME"));
  assert.ok(params.includes("Alta"));
});

test("buildReportsListingQuery: agrega LIMIT/OFFSET y COUNT(*) OVER() para metadata en 1 round-trip", () => {
  const { sql } = buildReportsListingQuery(BASE_OPTIONS, 2, 25);
  assert.match(sql, /COUNT\(\*\) OVER\(\) AS total_count/);
  assert.match(sql, /LIMIT 25 OFFSET 25/, "página 2 de 25 -> offset 25");
});

test("buildReportsExportQuery: sin OFFSET de usuario, tope fijo MAX_EXPORT_ROWS acotando `capped` antes del enriquecimiento", () => {
  const { sql } = buildReportsExportQuery(BASE_OPTIONS);
  assert.match(sql, new RegExp(`LIMIT ${MAX_EXPORT_ROWS}\\b`));
  assert.doesNotMatch(sql, /OFFSET/);
});

test("shapeReportRow: primary solo existe cuando code Y severity están presentes; findings pasa through", () => {
  const withPrimary = shapeReportRow({
    fieldbeat_task_id: "900005",
    fieldbeat_task_date: "2026-03-10",
    client_name: "ACME",
    technician_names: "Juan",
    equipment_internal_ids: "EQ-1",
    task_type: "PM",
    origen: "APK",
    report_quality_status: "REVIEW_REQUIRED",
    has_ticket_reported: false,
    ticket_accessible: null,
    primary_code: "PART_AMBIGUOUS_MATCH",
    primary_severity: "Alta",
    findings: [{ code: "PART_AMBIGUOUS_MATCH", severity: "Alta" }],
    additional_participants: []
  });
  assert.deepEqual(withPrimary.primary, { code: "PART_AMBIGUOUS_MATCH", severity: "Alta" });

  const clean = shapeReportRow({
    fieldbeat_task_id: "900001",
    fieldbeat_task_date: "2026-03-10",
    client_name: "ACME",
    technician_names: "Juan",
    equipment_internal_ids: "EQ-1",
    task_type: "PM",
    origen: "APK",
    report_quality_status: "OK",
    has_ticket_reported: false,
    ticket_accessible: null,
    primary_code: null,
    primary_severity: null,
    findings: [],
    additional_participants: []
  });
  assert.equal(clean.primary, null);
  assert.deepEqual(clean.findings, []);
});

// HOTFIX de integridad de datos FieldBeat (Stage 10 - columna aditiva) -
// `additionalParticipants` nunca reemplaza `tecnico` (responsable
// principal, sin cambios) - es aditiva, refleja quality.fieldbeat_report_participants
// con is_primary=false. Caso 3453: Manuel Reyes sigue en `tecnico`, Alexis
// Acevedo aparece en `additionalParticipants`.
test("shapeReportRow: additionalParticipants es aditivo, nunca reemplaza a tecnico (responsable principal)", () => {
  const row = shapeReportRow({
    fieldbeat_task_id: "3453",
    fieldbeat_task_date: "2026-01-05",
    client_name: "Cliente X",
    technician_names: "Manuel Reyes",
    equipment_internal_ids: "EQ-1",
    task_type: "CORRECTIVA PROGRAMADA",
    origen: "APK",
    report_quality_status: "OK",
    has_ticket_reported: false,
    ticket_accessible: null,
    primary_code: null,
    primary_severity: null,
    findings: [],
    additional_participants: ["Alexis Acevedo"]
  });
  assert.equal(row.tecnico, "Manuel Reyes", "el responsable principal nunca se altera por la columna aditiva");
  assert.deepEqual(row.additionalParticipants, ["Alexis Acevedo"]);
});

test("shapeReportRow: sin participantes adicionales, additionalParticipants es [] (nunca null)", () => {
  const row = shapeReportRow({
    fieldbeat_task_id: "900001",
    fieldbeat_task_date: "2026-03-10",
    client_name: "ACME",
    technician_names: "Juan",
    equipment_internal_ids: "EQ-1",
    task_type: "PM",
    origen: "APK",
    report_quality_status: "OK",
    has_ticket_reported: false,
    ticket_accessible: null,
    primary_code: null,
    primary_severity: null,
    findings: [],
    additional_participants: null
  });
  assert.deepEqual(row.additionalParticipants, []);
});

// Regresión de rendimiento (ver informe): el enriquecimiento de
// participantes se movió de `base` (evaluado para TODO el universo
// filtrado) a una agregación restringida a los fieldbeat_task_id ya
// paginados (buildEnrichmentCte) - la fuente canónica sigue siendo
// exactamente la misma vista, is_primary=false sin cambios, solo se
// verifica en el SQL final del listado, no en `base` por sí sola.
test("buildReportsListingQuery: incluye additional_participants vía agregación contra quality.fieldbeat_report_participants (is_primary=false) restringida a la página, fuente canónica única", () => {
  const { sql } = buildReportsListingQuery(BASE_OPTIONS, 1, 25);
  assert.match(sql, /quality\.fieldbeat_report_participants/);
  assert.match(sql, /is_primary\s*=\s*false/);
  assert.match(sql, /additional_participants/);
  assert.match(sql, /fieldbeat_task_id IN \(SELECT fieldbeat_task_id FROM paged\)/, "restringido a la página, nunca al universo completo");
});

test("isExportOverLimit: exactamente MAX_EXPORT_ROWS es aceptable, MAX_EXPORT_ROWS+1 se rechaza", () => {
  assert.equal(isExportOverLimit(MAX_EXPORT_ROWS), false, "el límite exacto NO se rechaza (nunca se pierde la última fila válida)");
  assert.equal(isExportOverLimit(MAX_EXPORT_ROWS + 1), true);
  assert.equal(isExportOverLimit(0), false);
  assert.equal(isExportOverLimit(1), false);
});
