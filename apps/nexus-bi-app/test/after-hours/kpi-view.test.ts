import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterHoursConfidenceScore,
  formatHours,
  formatInt,
  notCalculableConfidenceScore,
  overallConfidenceScore,
  populationBreakdown,
  showContractualConfidence
} from "../../lib/after-hours-kpi-view.ts";
import type { AfterHoursSummary } from "../../types/after-hours.ts";

// Fixture mínimo válido - solo los campos que consume lib/after-hours-kpi-view.ts.
// Los overrides permiten a cada test variar exactamente el campo bajo prueba.
function buildSummary(overrides: Partial<AfterHoursSummary> = {}): AfterHoursSummary {
  return {
    total_tasks: 100,
    calculable_tasks: 80,
    not_calculable_tasks: 20,
    contractual_tasks: 50,
    legacy_schedule_tasks: 30,
    none_tasks: 20,
    fallback_tasks: 10,
    businessHoursStatus: "OK",
    holidaysStatus: "OK",
    filterOptions: { clientes: [], tecnicos: [], tiposTarea: [], dataBases: [], coverageReasonCodes: [], contractualReasonCodes: [] },
    kpis: {
      totalHours: { value: 400, confidence_score: 88, confidence_label: "Alta" },
      businessHours: { value: 300, confidence_score: 88, confidence_label: "Alta" },
      afterHoursHours: { value: 100, confidence_score: 88, confidence_label: "Alta" },
      afterHoursRate: { value: 0.25, confidence_score: 88, confidence_label: "Alta" },
      tasksWithAfterHours: { value: 40, confidence_score: 75, confidence_label: "Media" },
      tasksNotCalculable: { value: 20, confidence_score: 95, confidence_label: "Alta" }
    },
    byDataBasis: [],
    confidence_eligible_tasks: 80,
    confidence_excluded_tasks: 20,
    ...overrides
  } as AfterHoursSummary;
}

// === Formateo (es-CL, no libre) ===

test("formatInt: separador de miles es-CL", () => {
  assert.equal(formatInt(12345), "12.345");
});

test("formatHours: 1 decimal + unidad 'h'", () => {
  assert.equal(formatHours(12.345), "12,3 h");
});

// === Confianza gateada por población real (§8: absence -> '—', never 0) ===

test("overallConfidenceScore: calculable_tasks=0 -> null (nunca el score subyacente del backend)", () => {
  const summary = buildSummary({ calculable_tasks: 0 });
  assert.equal(overallConfidenceScore(summary), null);
});

test("overallConfidenceScore: calculable_tasks>0 -> el score real de kpis.totalHours", () => {
  const summary = buildSummary({ calculable_tasks: 80 });
  assert.equal(overallConfidenceScore(summary), 88);
});

test("afterHoursConfidenceScore: tasksWithAfterHours.value=0 -> null", () => {
  const summary = buildSummary();
  summary.kpis.tasksWithAfterHours.value = 0;
  assert.equal(afterHoursConfidenceScore(summary), null);
});

test("notCalculableConfidenceScore: none_tasks=0 -> null; none_tasks>0 -> score real (fijo Alta/95, KPI 6 no penalizado)", () => {
  assert.equal(notCalculableConfidenceScore(buildSummary({ none_tasks: 0 })), null);
  assert.equal(notCalculableConfidenceScore(buildSummary({ none_tasks: 20 })), 95);
});

// === Confianza contractual: gate estricto contractual_tasks>0 (§10) ===

test("showContractualConfidence: contractual_tasks=0 -> false (NUNCA se muestra la sección)", () => {
  assert.equal(showContractualConfidence(buildSummary({ contractual_tasks: 0 })), false);
});

test("showContractualConfidence: contractual_tasks>0 -> true", () => {
  assert.equal(showContractualConfidence(buildSummary({ contractual_tasks: 1 })), true);
});

// === Desglose de población (§8: orden fijo, mapeo correcto a cada campo) ===

test("populationBreakdown: 4 items en el orden exacto Tareas calculables / Con contrato / Con horario global / No calculables", () => {
  const summary = buildSummary({ calculable_tasks: 80, contractual_tasks: 50, legacy_schedule_tasks: 30, none_tasks: 20 });
  const breakdown = populationBreakdown(summary);
  assert.deepEqual(
    breakdown.map(b => b.label),
    ["Tareas calculables", "Con contrato", "Con horario global", "No calculables"]
  );
  assert.deepEqual(
    breakdown.map(b => b.value),
    [80, 50, 30, 20]
  );
});

test("populationBreakdown: no confunde contractual_tasks con legacy_schedule_tasks (regresión de mapeo)", () => {
  const summary = buildSummary({ contractual_tasks: 5, legacy_schedule_tasks: 99 });
  const breakdown = populationBreakdown(summary);
  assert.equal(breakdown.find(b => b.label === "Con contrato")!.value, 5);
  assert.equal(breakdown.find(b => b.label === "Con horario global")!.value, 99);
});
