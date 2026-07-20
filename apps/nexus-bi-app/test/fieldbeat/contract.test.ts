import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCount, parseFieldbeatDashboardResponse, FieldbeatContractError } from "../../lib/fieldbeat-contract.ts";

// ETAPA 5 - fixtures sintéticos pequeños, nunca un JSON real completo
// copiado al repo como golden fixture (la certificación con datos reales
// es un proceso aparte, ver reporte final).

function validKpis() {
  return {
    total_fieldbeat_reports: "3747",
    reports_no_ticket_reported: "2537",
    reports_linked_to_accessible_zendesk: "290",
    reports_linked_to_missing_or_restricted_zendesk: "920",
    reports_with_used_parts: "1809",
    reports_ok: "480",
    reports_review_required: "1329",
    total_used_parts: "2193",
    matched_used_parts: "927",
    placeholder_used_parts: "721",
    unmatched_used_parts: "489",
    ambiguous_used_parts: "56",
    zendesk_link_rate: "7.74%",
    used_parts_match_rate: "42.27%",
    review_required_rate: "64.39%"
  };
}

function validDataQualityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    report_quality_status: "OK",
    report_count: "480",
    percent_of_total_reports: "12.81%",
    used_parts_count: "480",
    matched_used_parts_count: "480",
    placeholder_used_parts_count: "0",
    unmatched_used_parts_count: "0",
    ambiguous_used_parts_count: "0",
    ...overrides
  };
}

function validResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kpis: validKpis(),
    dataQuality: [validDataQualityRow()],
    reportsByClient: [{ client_name: "Cliente A", total_reports: "10" }],
    partsConsumptionByClient: [{ client_name: "Cliente A", used_parts_count: "5" }],
    topEquipmentByParts: [{ equipment_internal_id: "EQ-1", used_parts_count: "3" }],
    ...overrides
  };
}

// === parseCount ===

test("parseCount: acepta 0 y 12 como number", () => {
  assert.equal(parseCount(0, "x"), 0);
  assert.equal(parseCount(12, "x"), 12);
});

test("parseCount: acepta '0' y '12' como string decimal", () => {
  assert.equal(parseCount("0", "x"), 0);
  assert.equal(parseCount("12", "x"), 12);
});

test("parseCount: rechaza string vacío o solo espacios", () => {
  assert.throws(() => parseCount("", "x"), FieldbeatContractError);
  assert.throws(() => parseCount(" ", "x"), FieldbeatContractError);
});

test("parseCount: rechaza cero a la izquierda ('01')", () => {
  assert.throws(() => parseCount("01", "x"), FieldbeatContractError);
});

test("parseCount: rechaza signo explícito ('+1', '-1')", () => {
  assert.throws(() => parseCount("+1", "x"), FieldbeatContractError);
  assert.throws(() => parseCount("-1", "x"), FieldbeatContractError);
});

test("parseCount: rechaza decimales y notación científica ('1.5', '1e3')", () => {
  assert.throws(() => parseCount("1.5", "x"), FieldbeatContractError);
  assert.throws(() => parseCount("1e3", "x"), FieldbeatContractError);
});

test("parseCount: rechaza number no entero (1.5) y negativo (-1)", () => {
  assert.throws(() => parseCount(1.5, "x"), FieldbeatContractError);
  assert.throws(() => parseCount(-1, "x"), FieldbeatContractError);
});

test("parseCount: rechaza NaN e Infinity", () => {
  assert.throws(() => parseCount(NaN, "x"), FieldbeatContractError);
  assert.throws(() => parseCount(Infinity, "x"), FieldbeatContractError);
});

test("parseCount: rechaza fuera de Number.MAX_SAFE_INTEGER (number y string equivalente)", () => {
  assert.throws(() => parseCount(Number.MAX_SAFE_INTEGER + 1, "x"), FieldbeatContractError);
  assert.throws(() => parseCount("9007199254740992", "x"), FieldbeatContractError); // 2^53, pasa el regex pero falla isSafeInteger
});

test("parseCount: acepta exactamente Number.MAX_SAFE_INTEGER", () => {
  assert.equal(parseCount(Number.MAX_SAFE_INTEGER, "x"), Number.MAX_SAFE_INTEGER);
});

test("parseCount: rechaza tipos no soportados (null, undefined, boolean, object, array)", () => {
  assert.throws(() => parseCount(null, "x"), FieldbeatContractError);
  assert.throws(() => parseCount(undefined, "x"), FieldbeatContractError);
  assert.throws(() => parseCount(true, "x"), FieldbeatContractError);
  assert.throws(() => parseCount({}, "x"), FieldbeatContractError);
  assert.throws(() => parseCount([], "x"), FieldbeatContractError);
});

// === parseFieldbeatDashboardResponse ===

test("parseFieldbeatDashboardResponse: respuesta válida completa se normaliza a number", () => {
  const parsed = parseFieldbeatDashboardResponse(validResponse());
  assert.equal(parsed.kpis?.total_fieldbeat_reports, 3747);
  assert.equal(typeof parsed.kpis?.total_fieldbeat_reports, "number");
  assert.equal(parsed.dataQuality[0].report_count, 480);
  assert.equal(parsed.reportsByClient[0].total_reports, 10);
  assert.equal(parsed.partsConsumptionByClient[0].used_parts_count, 5);
  assert.equal(parsed.topEquipmentByParts[0].used_parts_count, 3);
});

test("parseFieldbeatDashboardResponse: conteos como number nativo también se aceptan", () => {
  const kpis = validKpis();
  const asNumbers = Object.fromEntries(
    Object.entries(kpis).map(([k, v]) => (typeof v === "string" && /^\d+$/.test(v) ? [k, Number(v)] : [k, v]))
  );
  const parsed = parseFieldbeatDashboardResponse(validResponse({ kpis: asNumbers }));
  assert.equal(parsed.kpis?.total_fieldbeat_reports, 3747);
});

test("parseFieldbeatDashboardResponse: kpis=null es un estado válido, no un error", () => {
  const parsed = parseFieldbeatDashboardResponse(validResponse({ kpis: null }));
  assert.equal(parsed.kpis, null);
});

test("parseFieldbeatDashboardResponse: array ausente (clave faltante) lanza error descriptivo", () => {
  const response = validResponse();
  delete (response as Record<string, unknown>).reportsByClient;
  assert.throws(() => parseFieldbeatDashboardResponse(response), (err: unknown) => {
    assert.ok(err instanceof FieldbeatContractError);
    assert.match((err as Error).message, /reportsByClient/);
    return true;
  });
});

test("parseFieldbeatDashboardResponse: objeto incompleto (falta una clave de kpis) lanza error", () => {
  const kpis = validKpis();
  delete (kpis as Record<string, unknown>).total_fieldbeat_reports;
  assert.throws(() => parseFieldbeatDashboardResponse(validResponse({ kpis })), FieldbeatContractError);
});

test("parseFieldbeatDashboardResponse: report_quality_status desconocido se ACEPTA por el parser (no es una exigencia de transporte)", () => {
  const parsed = parseFieldbeatDashboardResponse(
    validResponse({ dataQuality: [validDataQualityRow({ report_quality_status: "SOME_FUTURE_STATUS" })] })
  );
  assert.equal(parsed.dataQuality[0].report_quality_status, "SOME_FUTURE_STATUS");
});

test("parseFieldbeatDashboardResponse: report_quality_status vacío/blanco se rechaza", () => {
  assert.throws(() => parseFieldbeatDashboardResponse(validResponse({ dataQuality: [validDataQualityRow({ report_quality_status: "" })] })), FieldbeatContractError);
  assert.throws(() => parseFieldbeatDashboardResponse(validResponse({ dataQuality: [validDataQualityRow({ report_quality_status: "   " })] })), FieldbeatContractError);
});

test("parseFieldbeatDashboardResponse: report_quality_status null/number/object/array se rechaza", () => {
  for (const bad of [null, 123, {}, []]) {
    assert.throws(() => parseFieldbeatDashboardResponse(validResponse({ dataQuality: [validDataQualityRow({ report_quality_status: bad })] })), FieldbeatContractError);
  }
});

test("parseFieldbeatDashboardResponse: porcentaje TEXT malformado se rechaza", () => {
  assert.throws(() => parseFieldbeatDashboardResponse(validResponse({ kpis: { ...validKpis(), zendesk_link_rate: "not-a-percent" } })), FieldbeatContractError);
  assert.throws(() => parseFieldbeatDashboardResponse(validResponse({ dataQuality: [validDataQualityRow({ percent_of_total_reports: "12,81%" })] })), FieldbeatContractError);
});

test("parseFieldbeatDashboardResponse: respuesta que no es un objeto se rechaza", () => {
  assert.throws(() => parseFieldbeatDashboardResponse(null), FieldbeatContractError);
  assert.throws(() => parseFieldbeatDashboardResponse("x"), FieldbeatContractError);
  assert.throws(() => parseFieldbeatDashboardResponse([]), FieldbeatContractError);
});

test("parseFieldbeatDashboardResponse: arrays vacíos son válidos (no un error de forma)", () => {
  const parsed = parseFieldbeatDashboardResponse(
    validResponse({ dataQuality: [], reportsByClient: [], partsConsumptionByClient: [], topEquipmentByParts: [] })
  );
  assert.deepEqual(parsed.dataQuality, []);
  assert.deepEqual(parsed.reportsByClient, []);
});
