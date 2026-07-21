import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFieldbeatPageStatus } from "../../lib/fieldbeat-page-status.ts";
import type { FieldbeatDashboardResponse, FieldbeatKpis } from "../../types/fieldbeat.ts";

// evaluateFieldbeatPageStatus() recibe SOLO un contrato ya validado y
// normalizado (nunca errores de transporte/contrato - esos se resuelven
// antes, en use-fieldbeat-dashboard.ts, como status:"error" del hook).

function fixtureKpis(overrides: Partial<FieldbeatKpis> = {}): FieldbeatKpis {
  return {
    total_fieldbeat_reports: 100,
    reports_no_ticket_reported: 60,
    reports_linked_to_accessible_zendesk: 10,
    reports_linked_to_missing_or_restricted_zendesk: 30,
    reports_with_used_parts: 40,
    reports_ok: 20,
    reports_review_required: 15,
    total_used_parts: 50,
    matched_used_parts: 20,
    placeholder_used_parts: 15,
    unmatched_used_parts: 10,
    ambiguous_used_parts: 5,
    zendesk_link_rate: "10.00%",
    used_parts_match_rate: "40.00%",
    review_required_rate: "30.00%",
    ...overrides
  };
}

function emptyResponse(overrides: Partial<FieldbeatDashboardResponse> = {}): FieldbeatDashboardResponse {
  return {
    kpis: null,
    dataQuality: [],
    reportsByClient: [],
    partsConsumptionByClient: [],
    topEquipmentByParts: [],
    ...overrides
  };
}

function dqRow(status: string, count: number) {
  return {
    report_quality_status: status,
    report_count: count,
    percent_of_total_reports: "0.00%",
    used_parts_count: 0,
    matched_used_parts_count: 0,
    placeholder_used_parts_count: 0,
    unmatched_used_parts_count: 0,
    ambiguous_used_parts_count: 0
  };
}

test("kpis===null y todas las colecciones vacías -> empty", () => {
  assert.equal(evaluateFieldbeatPageStatus(emptyResponse()), "empty");
});

test("kpis===null pero dataQuality tiene filas con report_count real (no 0) -> partial_inconsistent", () => {
  const data = emptyResponse({ dataQuality: [dqRow("OK", 5)] });
  assert.equal(evaluateFieldbeatPageStatus(data), "partial_inconsistent");
});

test("kpis===null pero reportsByClient tiene filas -> partial_inconsistent", () => {
  const data = emptyResponse({ reportsByClient: [{ client_name: "C1", total_reports: 3 }] });
  assert.equal(evaluateFieldbeatPageStatus(data), "partial_inconsistent");
});

test("kpis===null pero partsConsumptionByClient tiene filas -> partial_inconsistent", () => {
  const data = emptyResponse({ partsConsumptionByClient: [{ client_name: "C1", used_parts_count: 3 }] });
  assert.equal(evaluateFieldbeatPageStatus(data), "partial_inconsistent");
});

test("kpis===null pero topEquipmentByParts tiene filas -> partial_inconsistent", () => {
  const data = emptyResponse({ topEquipmentByParts: [{ equipment_internal_id: "EQ-1", used_parts_count: 3 }] });
  assert.equal(evaluateFieldbeatPageStatus(data), "partial_inconsistent");
});

test("kpis presente con total_fieldbeat_reports=0 y todas las colecciones en cero actividad -> zero_universe", () => {
  const data = emptyResponse({ kpis: fixtureKpis({ total_fieldbeat_reports: 0 }) });
  assert.equal(evaluateFieldbeatPageStatus(data), "zero_universe");
});

test("dataQuality con las 6 filas canónicas pero TODAS con report_count=0 sigue siendo compatible con zero_universe (nunca se usa .length)", () => {
  const sixZeroRows = ["OK", "NO_USED_PARTS", "HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"].map(s => dqRow(s, 0));
  const data = emptyResponse({ kpis: fixtureKpis({ total_fieldbeat_reports: 0 }), dataQuality: sixZeroRows });
  assert.equal(evaluateFieldbeatPageStatus(data), "zero_universe");
});

test("kpis presente con total_fieldbeat_reports=0 pero alguna colección SÍ tiene actividad real -> partial_inconsistent (inconsistencia real, no se oculta)", () => {
  const data = emptyResponse({ kpis: fixtureKpis({ total_fieldbeat_reports: 0 }), reportsByClient: [{ client_name: "C1", total_reports: 3 }] });
  assert.equal(evaluateFieldbeatPageStatus(data), "partial_inconsistent");
});

test("kpis presente con total_fieldbeat_reports=0 pero dataQuality tiene report_count>0 real -> partial_inconsistent", () => {
  const data = emptyResponse({ kpis: fixtureKpis({ total_fieldbeat_reports: 0 }), dataQuality: [dqRow("OK", 5)] });
  assert.equal(evaluateFieldbeatPageStatus(data), "partial_inconsistent");
});

test("kpis presente con total_fieldbeat_reports>0 -> success", () => {
  const data = emptyResponse({ kpis: fixtureKpis({ total_fieldbeat_reports: 100 }) });
  assert.equal(evaluateFieldbeatPageStatus(data), "success");
});
