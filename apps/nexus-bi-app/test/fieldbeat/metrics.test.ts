import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRatio, percentLabel, buildExecutiveSummary, buildPartsPresence, buildTicketLinkage } from "../../lib/fieldbeat-metrics.ts";
import type { FieldbeatKpis } from "../../types/fieldbeat.ts";

function fixtureKpis(overrides: Partial<FieldbeatKpis> = {}): FieldbeatKpis {
  return {
    total_fieldbeat_reports: 3747,
    reports_no_ticket_reported: 2537,
    reports_linked_to_accessible_zendesk: 290,
    reports_linked_to_missing_or_restricted_zendesk: 920,
    reports_with_used_parts: 1809,
    reports_ok: 480,
    reports_review_required: 1329,
    total_used_parts: 2193,
    matched_used_parts: 927,
    placeholder_used_parts: 721,
    unmatched_used_parts: 489,
    ambiguous_used_parts: 56,
    zendesk_link_rate: "7.74%",
    used_parts_match_rate: "42.27%",
    review_required_rate: "64.39%",
    ...overrides
  };
}

// === safeRatio ===

test("safeRatio: denominador cero -> null (nunca NaN/Infinity)", () => {
  assert.equal(safeRatio(10, 0), null);
});

test("safeRatio: denominador negativo -> null", () => {
  assert.equal(safeRatio(10, -5), null);
});

test("safeRatio: ratio normal", () => {
  assert.equal(safeRatio(50, 200), 0.25);
});

// === percentLabel ===

test("percentLabel: denominador cero -> '-' ", () => {
  assert.equal(percentLabel(10, 0), "-");
});

test("percentLabel: formatea con coma decimal es-CL", () => {
  assert.equal(percentLabel(1809, 3747, 1), "48,3 %");
});

// === buildExecutiveSummary - composición EXACTA de las 6 posiciones del
// mockup (ETAPA 5-V): 3 de las 6 son honestamente "no disponible" siempre,
// nunca se reemplazan por otras 6 métricas reales solo porque existen en
// el contrato. ===

test("buildExecutiveSummary: kpis=null -> totalReports y reportsWithParts 'unavailable', las otras 4 SIEMPRE 'unavailable'", () => {
  const summary = buildExecutiveSummary(null);
  assert.equal(summary.totalReports.status, "unavailable");
  assert.equal(summary.reportsWithParts.status, "unavailable");
  assert.equal(summary.clientsWithActivity.status, "unavailable");
  assert.equal(summary.equipmentAttended.status, "unavailable");
  assert.equal(summary.predominantTaskType.status, "unavailable");
  assert.equal(summary.recentActivity.status, "unavailable");
});

test("buildExecutiveSummary: kpis real -> totalReports y reportsWithParts 'available' con valores reales calculados", () => {
  const summary = buildExecutiveSummary(fixtureKpis());
  assert.equal(summary.totalReports.status, "available");
  if (summary.totalReports.status === "available") assert.equal(summary.totalReports.value, 3747);

  assert.equal(summary.reportsWithParts.status, "available");
  if (summary.reportsWithParts.status === "available") {
    assert.equal(summary.reportsWithParts.value, 1809);
    // 1809/3747 = 48.28...% -> coma decimal, nunca el TEXT crudo "7.74%"/"42.27%"/"64.39%" del kpis
    assert.ok(summary.reportsWithParts.hint?.includes(","));
  }
});

test("buildExecutiveSummary: clientsWithActivity/equipmentAttended/predominantTaskType/recentActivity son SIEMPRE 'unavailable', incluso con kpis real (no existe campo real que los respalde)", () => {
  const summary = buildExecutiveSummary(fixtureKpis());
  for (const slot of [summary.clientsWithActivity, summary.equipmentAttended, summary.predominantTaskType, summary.recentActivity]) {
    assert.equal(slot.status, "unavailable");
    if (slot.status === "unavailable") assert.ok(slot.reason.length > 0);
  }
});

test("buildExecutiveSummary: acentos coinciden con el mockup (verde/púrpura/oscuro/default)", () => {
  const summary = buildExecutiveSummary(fixtureKpis());
  assert.equal(summary.totalReports.accent, "green");
  assert.equal(summary.reportsWithParts.accent, "purple");
  assert.equal(summary.recentActivity.accent, "dark");
  assert.equal(summary.clientsWithActivity.accent, "default");
  assert.equal(summary.equipmentAttended.accent, "default");
  assert.equal(summary.predominantTaskType.accent, "default");
});

test("buildExecutiveSummary: denominador cero no produce NaN/Infinity en el hint de reportsWithParts", () => {
  const summary = buildExecutiveSummary(fixtureKpis({ total_fieldbeat_reports: 0, reports_with_used_parts: 0 }));
  if (summary.reportsWithParts.status === "available") {
    assert.equal(Boolean(summary.reportsWithParts.hint?.includes("NaN")), false);
    assert.equal(Boolean(summary.reportsWithParts.hint?.includes("Infinity")), false);
  }
});

test("buildExecutiveSummary: firma de un solo parámetro (kpis) - ningún slot puede derivarse de un array de ranking top-10", () => {
  assert.equal(buildExecutiveSummary.length, 1);
});

// === buildPartsPresence ===

test("buildPartsPresence: withParts + withoutParts === totalReports", () => {
  const presence = buildPartsPresence(fixtureKpis());
  assert.equal(presence.withParts + presence.withoutParts, presence.totalReports);
  assert.equal(presence.withParts, 1809);
  assert.equal(presence.withoutParts, 3747 - 1809);
  assert.equal(presence.totalReports, 3747);
});

// === buildTicketLinkage ===

test("buildTicketLinkage: los 3 valores suman total_fieldbeat_reports (invariante #1)", () => {
  const linkage = buildTicketLinkage(fixtureKpis());
  assert.equal(linkage.accessible + linkage.missingOrRestricted + linkage.noTicket, linkage.totalReports);
  assert.equal(linkage.accessible, 290);
  assert.equal(linkage.missingOrRestricted, 920);
  assert.equal(linkage.noTicket, 2537);
  assert.equal(linkage.totalReports, 3747);
});
