import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReportsPageSize,
  parseReportsPage,
  parseReportsView,
  parseReportsSort,
  parseReportsDirection,
  parseReportsSearch,
  buildReportsFilteredCte,
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

test("buildReportsFilteredCte: vista 'exceptions' agrega WHERE primary_code IS NOT NULL; 'all' no filtra por inconsistencia", () => {
  const exceptions = buildReportsFilteredCte(BASE_OPTIONS);
  assert.match(exceptions.cteSql, /WHERE primary_code IS NOT NULL/);

  const all = buildReportsFilteredCte({ ...BASE_OPTIONS, view: "all" });
  assert.doesNotMatch(all.cteSql, /primary_code IS NOT NULL/);
});

test("buildReportsFilteredCte: búsqueda por ID agrega condición exacta-o-prefijo parametrizada, nunca interpolada", () => {
  const { cteSql, params } = buildReportsFilteredCte({ ...BASE_OPTIONS, search: "9000" });
  assert.match(cteSql, /CAST\(u\.fieldbeat_task_id AS TEXT\) = \$\d+ OR CAST\(u\.fieldbeat_task_id AS TEXT\) LIKE \$\d+/);
  assert.ok(params.includes("9000"));
  assert.ok(params.includes("9000%"));
});

test("buildReportsFilteredCte: sort/direction se reflejan en ORDER BY con empate estable por id", () => {
  const { orderBySql } = buildReportsFilteredCte({ ...BASE_OPTIONS, sort: "severity", direction: "asc" });
  assert.match(orderBySql, /ORDER BY severity_rank ASC NULLS LAST, fieldbeat_task_id ASC/);
});

test("buildReportsFilteredCte: filtros comunes (client/severity/etc.) se delegan a buildFieldbeatQualityConditions, nunca reimplementados acá", () => {
  const { cteSql, params } = buildReportsFilteredCte({ ...BASE_OPTIONS, filters: { client: "ACME", severity: "Alta" } });
  assert.match(cteSql, /u\.client_name = \$\d+/);
  assert.ok(params.includes("ACME"));
  assert.ok(params.includes("Alta"));
});

test("buildReportsListingQuery: agrega LIMIT/OFFSET y COUNT(*) OVER() para metadata en 1 round-trip", () => {
  const { sql } = buildReportsListingQuery(BASE_OPTIONS, 2, 25);
  assert.match(sql, /COUNT\(\*\) OVER\(\) AS total_count/);
  assert.match(sql, /LIMIT 25 OFFSET 25/, "página 2 de 25 -> offset 25");
});

test("buildReportsExportQuery: sin OFFSET de usuario, tope fijo MAX_EXPORT_ROWS", () => {
  const { sql } = buildReportsExportQuery(BASE_OPTIONS);
  assert.match(sql.trim(), new RegExp(`LIMIT ${MAX_EXPORT_ROWS}$`));
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
    primary_code: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY",
    primary_severity: "Alta",
    findings: [{ code: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY", severity: "Alta" }]
  });
  assert.deepEqual(withPrimary.primary, { code: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY", severity: "Alta" });

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
    findings: []
  });
  assert.equal(clean.primary, null);
  assert.deepEqual(clean.findings, []);
});

test("isExportOverLimit: exactamente MAX_EXPORT_ROWS es aceptable, MAX_EXPORT_ROWS+1 se rechaza", () => {
  assert.equal(isExportOverLimit(MAX_EXPORT_ROWS), false, "el límite exacto NO se rechaza (nunca se pierde la última fila válida)");
  assert.equal(isExportOverLimit(MAX_EXPORT_ROWS + 1), true);
  assert.equal(isExportOverLimit(0), false);
  assert.equal(isExportOverLimit(1), false);
});
