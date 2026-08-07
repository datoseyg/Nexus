import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFieldbeatUrlState,
  buildFieldbeatQueryString,
  buildFieldbeatReportsQuery,
  buildFieldbeatReportsExportQuery,
  hasActiveFilters,
  DEFAULT_FIELDBEAT_TAB,
  DEFAULT_EVOLUTION_SERIES
} from "../../lib/fieldbeat-tabs-url-state.ts";

function sp(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

test("sin tab en la URL resuelve a overview (default)", () => {
  const state = readFieldbeatUrlState(sp({}));
  assert.equal(state.tab, "overview");
  assert.equal(state.tab, DEFAULT_FIELDBEAT_TAB);
});

test("tab presente y válido en la URL se respeta", () => {
  assert.equal(readFieldbeatUrlState(sp({ tab: "quality" })).tab, "quality");
  assert.equal(readFieldbeatUrlState(sp({ tab: "crossings" })).tab, "crossings");
  assert.equal(readFieldbeatUrlState(sp({ tab: "reports" })).tab, "reports");
});

test("tab inválido vuelve al default seguro, nunca lanza", () => {
  assert.equal(readFieldbeatUrlState(sp({ tab: "bogus-tab" })).tab, "overview");
  assert.equal(readFieldbeatUrlState(sp({ tab: "" })).tab, "overview");
});

test("cruce inválido vuelve al primero de la lista (task_type_missing_field)", () => {
  assert.equal(readFieldbeatUrlState(sp({ crossing: "nope" })).crossing, "task_type_missing_field");
  assert.equal(readFieldbeatUrlState(sp({ crossing: "equipment_problem" })).crossing, "equipment_problem");
});

test("serie de evolución inválida vuelve al default (inconsistencies)", () => {
  assert.equal(readFieldbeatUrlState(sp({ evolution: "nope" })).evolutionSeries, DEFAULT_EVOLUTION_SERIES);
  assert.equal(readFieldbeatUrlState(sp({ evolution: "traceability" })).evolutionSeries, "traceability");
});

test("filtros se leen y persisten - cambiar de pestaña nunca los borra (misma función de lectura para las 4 tabs)", () => {
  const params = sp({ tab: "quality", client: "ACME", severity: "Alta", dateFrom: "2026-01-01" });
  const state = readFieldbeatUrlState(params);
  assert.equal(state.filters.client, "ACME");
  assert.equal(state.filters.severity, "Alta");
  assert.equal(state.filters.dateFrom, "2026-01-01");
  assert.ok(hasActiveFilters(state.filters));
});

test("severity/enum inválidos en filtros se ignoran (undefined), no rompen la lectura", () => {
  const state = readFieldbeatUrlState(sp({ severity: "Critica", ticketStatus: "bogus" }));
  assert.equal(state.filters.severity, undefined);
  assert.equal(state.filters.ticketStatus, undefined);
});

const REPORTS_DEFAULTS = {
  reportsView: "exceptions" as const,
  reportsPage: 1,
  reportsPageSize: 25,
  reportsSort: "date" as const,
  reportsDirection: "desc" as const,
  reportsSearch: null,
  selectedReportId: null
};

test("buildFieldbeatQueryString: nunca escribe defaults (tab=overview, crossing por defecto, evolution por defecto, reportsPage=1 omitidos)", () => {
  const qs = buildFieldbeatQueryString({
    tab: "overview",
    filters: {},
    crossing: "task_type_missing_field",
    evolutionSeries: "inconsistencies",
    ...REPORTS_DEFAULTS
  });
  assert.equal(qs, "");
});

test("buildFieldbeatQueryString: round-trip con readFieldbeatUrlState preserva el estado", () => {
  const original = readFieldbeatUrlState(sp({ tab: "crossings", crossing: "equipment_problem", client: "ACME", severity: "Media" }));
  const qs = buildFieldbeatQueryString(original);
  const roundTripped = readFieldbeatUrlState(new URLSearchParams(qs));
  assert.deepEqual(roundTripped, original);
});

test("buildFieldbeatQueryString: reportsPage solo se escribe en la pestaña reports", () => {
  const qsOverview = buildFieldbeatQueryString({
    tab: "overview",
    filters: {},
    crossing: "task_type_missing_field",
    evolutionSeries: "inconsistencies",
    ...REPORTS_DEFAULTS,
    reportsPage: 3
  });
  assert.ok(!qsOverview.includes("reportsPage"), "reportsPage no debe filtrarse a otras pestañas");

  const qsReports = buildFieldbeatQueryString({
    tab: "reports",
    filters: {},
    crossing: "task_type_missing_field",
    evolutionSeries: "inconsistencies",
    ...REPORTS_DEFAULTS,
    reportsPage: 3
  });
  assert.match(qsReports, /reportsPage=3/);
});

test("hasActiveFilters: false cuando no hay ningún filtro activo", () => {
  assert.equal(hasActiveFilters({}), false);
});

// === Phase 4 - estado de URL de la bandeja de Reportes ===

test("reports: reportsView/reportsSort/reportsDirection/reportsSearch/report se leen y ausentes resuelven a su default", () => {
  const withoutParams = readFieldbeatUrlState(sp({ tab: "reports" }));
  assert.equal(withoutParams.reportsView, "exceptions");
  assert.equal(withoutParams.reportsSort, "date");
  assert.equal(withoutParams.reportsDirection, "desc");
  assert.equal(withoutParams.reportsPageSize, 25);
  assert.equal(withoutParams.reportsSearch, null);
  assert.equal(withoutParams.selectedReportId, null);

  const withParams = readFieldbeatUrlState(
    sp({ tab: "reports", reportsView: "all", reportsSort: "severity", reportsDirection: "asc", reportsPageSize: "50", reportsSearch: "900005", report: "900005" })
  );
  assert.equal(withParams.reportsView, "all");
  assert.equal(withParams.reportsSort, "severity");
  assert.equal(withParams.reportsDirection, "asc");
  assert.equal(withParams.reportsPageSize, 50);
  assert.equal(withParams.reportsSearch, "900005");
  assert.equal(withParams.selectedReportId, "900005");
});

test("reports: valores inválidos de reportsView/reportsSort/reportsDirection vuelven al default, nunca lanzan", () => {
  const state = readFieldbeatUrlState(sp({ tab: "reports", reportsView: "bogus", reportsSort: "bogus", reportsDirection: "bogus", reportsPageSize: "999" }));
  assert.equal(state.reportsView, "exceptions");
  assert.equal(state.reportsSort, "date");
  assert.equal(state.reportsDirection, "desc");
  assert.equal(state.reportsPageSize, 25);
});

test("buildFieldbeatQueryString: reportsView/reportsSort/reportsDirection/reportsPageSize/reportsSearch/report en default nunca se escriben en la URL", () => {
  const qs = buildFieldbeatQueryString({
    tab: "reports",
    filters: {},
    crossing: "task_type_missing_field",
    evolutionSeries: "inconsistencies",
    ...REPORTS_DEFAULTS
  });
  assert.equal(qs, "tab=reports", "tab=reports SÍ se escribe (no es el default); ningún campo de reports en su valor default debe acompañarlo");
});

test("buildFieldbeatQueryString + readFieldbeatUrlState: round-trip completo de Reportes preserva el estado", () => {
  const original = readFieldbeatUrlState(
    sp({ tab: "reports", reportsView: "all", reportsPage: "3", reportsPageSize: "100", reportsSort: "client", reportsDirection: "asc", reportsSearch: "9000", report: "900010" })
  );
  const qs = buildFieldbeatQueryString(original);
  const roundTripped = readFieldbeatUrlState(new URLSearchParams(qs));
  assert.deepEqual(roundTripped, original);
});

test("buildFieldbeatReportsQuery: SIEMPRE envía page/pageSize/sort/direction/reportsView explícitos a la API (a diferencia de la URL visible, que omite defaults)", () => {
  const state = readFieldbeatUrlState(sp({ tab: "reports" }));
  const query = buildFieldbeatReportsQuery(state);
  const params = new URLSearchParams(query);
  assert.equal(params.get("reportsView"), "exceptions");
  assert.equal(params.get("page"), "1");
  assert.equal(params.get("pageSize"), "25");
  assert.equal(params.get("sort"), "date");
  assert.equal(params.get("direction"), "desc");
  assert.equal(params.get("search"), null, "sin búsqueda no se envía el parámetro");
});

test("buildFieldbeatReportsExportQuery: mismos filtros/view/sort que el listado, pero SIN page/pageSize", () => {
  const state = readFieldbeatUrlState(sp({ tab: "reports", reportsView: "all", reportsPage: "3", client: "ACME" }));
  const query = buildFieldbeatReportsExportQuery(state);
  const params = new URLSearchParams(query);
  assert.equal(params.get("reportsView"), "all");
  assert.equal(params.get("client"), "ACME");
  assert.equal(params.get("page"), null);
  assert.equal(params.get("pageSize"), null);
});

// === Phase 5 - cierre del drawer de detalle: elimina SOLO report, conserva todo lo demás ===

test("cerrar el drawer de detalle (selectedReportId: null) preserva tab/vista/página/pageSize/sort/dirección/búsqueda/filtros intactos", () => {
  const openState = readFieldbeatUrlState(
    sp({
      tab: "reports",
      reportsView: "all",
      reportsPage: "3",
      reportsPageSize: "50",
      reportsSort: "client",
      reportsDirection: "asc",
      reportsSearch: "9000",
      client: "ACME",
      severity: "Alta",
      report: "900010"
    })
  );
  assert.equal(openState.selectedReportId, "900010");

  // Simula exactamente lo que FieldbeatQualityShell hace al cerrar:
  // pushState({ selectedReportId: null }), nunca tocar ningún otro campo.
  const closedState = { ...openState, selectedReportId: null };
  const qs = buildFieldbeatQueryString(closedState);
  const params = new URLSearchParams(qs);

  assert.equal(params.get("report"), null, "report se elimina de la URL al cerrar");
  assert.equal(params.get("tab"), "reports");
  assert.equal(params.get("reportsView"), "all");
  assert.equal(params.get("reportsPage"), "3");
  assert.equal(params.get("reportsPageSize"), "50");
  assert.equal(params.get("reportsSort"), "client");
  assert.equal(params.get("reportsDirection"), "asc");
  assert.equal(params.get("reportsSearch"), "9000");
  assert.equal(params.get("client"), "ACME");
  assert.equal(params.get("severity"), "Alta");

  // Round-trip: leer la URL cerrada de vuelta reproduce exactamente closedState.
  const reopened = readFieldbeatUrlState(new URLSearchParams(qs));
  assert.deepEqual(reopened, closedState);
});
