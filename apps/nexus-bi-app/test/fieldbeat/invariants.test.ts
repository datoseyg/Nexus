import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTicketLinkageInvariant, checkDataQualitySumInvariant, checkUsedPartsSumInvariant, checkReportsOkInvariant } from "../../lib/fieldbeat-invariants.ts";
import type { FieldbeatDataQualityRow, FieldbeatKpis } from "../../types/fieldbeat.ts";

// Fixtures sintéticos pequeños (números de prueba, NO el baseline real) -
// la certificación con datos reales es un proceso aparte (ver reporte final).

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

function dqRow(status: string, count: number): FieldbeatDataQualityRow {
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

const SIX_CANONICAL_SUMMING_TO_100 = [
  dqRow("OK", 20),
  dqRow("NO_USED_PARTS", 30),
  dqRow("HAS_PLACEHOLDERS", 20),
  dqRow("HAS_UNMATCHED_PARTS", 15),
  dqRow("HAS_AMBIGUOUS_PARTS", 5),
  dqRow("REVIEW_REQUIRED", 10)
];

// === invariante #1: vinculación con tickets ===

test("checkTicketLinkageInvariant: caso sano - accessible+missingOrRestricted+noTicket === total", () => {
  const result = checkTicketLinkageInvariant(fixtureKpis({ reports_linked_to_accessible_zendesk: 10, reports_linked_to_missing_or_restricted_zendesk: 30, reports_no_ticket_reported: 60, total_fieldbeat_reports: 100 }));
  assert.equal(result.holds, true);
  assert.equal(result.sum, 100);
});

test("checkTicketLinkageInvariant: caso roto - la suma no coincide, se detecta y se reporta el sum real", () => {
  const result = checkTicketLinkageInvariant(fixtureKpis({ reports_linked_to_accessible_zendesk: 10, reports_linked_to_missing_or_restricted_zendesk: 30, reports_no_ticket_reported: 55, total_fieldbeat_reports: 100 }));
  assert.equal(result.holds, false);
  assert.equal(result.sum, 95);
});

// === invariante #2: SUM(dataQuality.report_count) === total ===

test("checkDataQualitySumInvariant: caso sano - 6 canónicas presentes, suma correcta, sin duplicados ni desconocidas", () => {
  const result = checkDataQualitySumInvariant(SIX_CANONICAL_SUMMING_TO_100, 100);
  assert.equal(result.holds, true);
  assert.equal(result.sum, 100);
  assert.equal(result.canonicalMissing.length, 0);
  assert.equal(result.unknownPresent.length, 0);
  assert.equal(result.duplicated.length, 0);
});

test("checkDataQualitySumInvariant: caso roto - la suma no coincide con total", () => {
  const result = checkDataQualitySumInvariant(SIX_CANONICAL_SUMMING_TO_100, 999);
  assert.equal(result.holds, false);
  assert.equal(result.sum, 100);
});

test("checkDataQualitySumInvariant: categoría faltante se reporta en canonicalMissing", () => {
  const fiveOfSix = SIX_CANONICAL_SUMMING_TO_100.slice(0, 5);
  const result = checkDataQualitySumInvariant(fiveOfSix, 90);
  assert.deepEqual(result.canonicalMissing, ["REVIEW_REQUIRED"]);
});

test("checkDataQualitySumInvariant: categoría desconocida se reporta en unknownPresent y SIGUE sumando (nunca se descarta)", () => {
  const withUnknown = [...SIX_CANONICAL_SUMMING_TO_100, dqRow("SOME_FUTURE_STATUS", 8)];
  const result = checkDataQualitySumInvariant(withUnknown, 108);
  assert.deepEqual(result.unknownPresent, ["SOME_FUTURE_STATUS"]);
  assert.equal(result.sum, 108); // incluye la desconocida en la suma
  assert.equal(result.holds, true);
});

test("checkDataQualitySumInvariant: categoría duplicada se reporta explícitamente, nunca se suma/sobrescribe en silencio", () => {
  const withDuplicate = [...SIX_CANONICAL_SUMMING_TO_100, dqRow("OK", 5)];
  const result = checkDataQualitySumInvariant(withDuplicate, 105);
  assert.deepEqual(result.duplicated, ["OK"]);
  // La suma real de report_count SÍ incluye ambas filas duplicadas (nunca oculta la inconsistencia con redondeo/descarte)
  assert.equal(result.sum, 105);
});

// === invariante #3: matched+placeholder+unmatched+ambiguous vs total_used_parts ===

test("checkUsedPartsSumInvariant: caso sano - la suma de los 4 buckets coincide con total_used_parts", () => {
  const result = checkUsedPartsSumInvariant(fixtureKpis({ matched_used_parts: 20, placeholder_used_parts: 15, unmatched_used_parts: 10, ambiguous_used_parts: 5, total_used_parts: 50 }));
  assert.equal(result.holds, true);
  assert.equal(result.sum, 50);
});

test("checkUsedPartsSumInvariant: caso roto - la suma no coincide, se reporta sin ocultar la discrepancia", () => {
  const result = checkUsedPartsSumInvariant(fixtureKpis({ matched_used_parts: 20, placeholder_used_parts: 15, unmatched_used_parts: 10, ambiguous_used_parts: 5, total_used_parts: 999 }));
  assert.equal(result.holds, false);
  assert.equal(result.sum, 50);
  assert.equal(result.totalUsedParts, 999);
});

// === invariante #4: reports_ok === dataQuality[OK].report_count ===

test("checkReportsOkInvariant: caso sano - reports_ok coincide con dataQuality[OK].report_count", () => {
  const result = checkReportsOkInvariant(fixtureKpis({ reports_ok: 20 }), SIX_CANONICAL_SUMMING_TO_100);
  assert.equal(result.applicable, true);
  assert.equal(result.holds, true);
  assert.equal(result.dataQualityOkCount, 20);
});

test("checkReportsOkInvariant: caso roto - reports_ok no coincide con dataQuality[OK].report_count", () => {
  const result = checkReportsOkInvariant(fixtureKpis({ reports_ok: 999 }), SIX_CANONICAL_SUMMING_TO_100);
  assert.equal(result.applicable, true);
  assert.equal(result.holds, false);
});

test("checkReportsOkInvariant: OK ausente en dataQuality -> no aplica (applicable=false), no se declara falsamente 'cumple'", () => {
  const withoutOk = SIX_CANONICAL_SUMMING_TO_100.filter(r => r.report_quality_status !== "OK");
  const result = checkReportsOkInvariant(fixtureKpis(), withoutOk);
  assert.equal(result.applicable, false);
  assert.equal(result.dataQualityOkCount, null);
});
