import { test } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_METRICS, getEvolutionMetric } from "../../lib/after-hours-evolution-view.ts";
import type { AfterHoursByDimensionRow } from "../../types/after-hours.ts";

function row(overrides: Partial<AfterHoursByDimensionRow> = {}): AfterHoursByDimensionRow {
  return {
    key: "2026-08",
    extra: null,
    total_tasks: 120,
    calculable_tasks: 100,
    not_calculable_tasks: 20,
    contractual_tasks: 40,
    legacy_schedule_tasks: 60,
    none_tasks: 20,
    fallback_tasks: 5,
    total_hours: 300,
    business_hours: 200,
    after_hours_total_hours: 50,
    after_hours_rate: 0.1667,
    tasks_total: 120,
    tasks_with_after_hours: 33,
    confidence_score: 82,
    confidence_label: "Media",
    average_confidence: 82,
    confidence_eligible_tasks: 100,
    confidence_excluded_tasks: 0,
    ...overrides
  };
}

test("EVOLUTION_METRICS: expone exactamente las 4 métricas requeridas (§4.2 del encargo)", () => {
  assert.deepEqual(
    EVOLUTION_METRICS.map(m => m.key),
    ["after_hours_hours", "total_tasks", "after_hours_tasks", "rate"]
  );
});

test("getEvolutionMetric('after_hours_hours'): lee after_hours_total_hours, unidad h", () => {
  const m = getEvolutionMetric("after_hours_hours");
  assert.equal(m.getValue(row()), 50);
  assert.equal(m.unit, "h");
  assert.equal(m.formatValue(50), "50 h");
});

test("getEvolutionMetric('total_tasks'): lee total_tasks (== tasks_total), unidad tareas", () => {
  const m = getEvolutionMetric("total_tasks");
  assert.equal(m.getValue(row()), 120);
  assert.equal(m.formatValue(120), "120");
});

test("getEvolutionMetric('after_hours_tasks'): lee tasks_with_after_hours, nunca total_tasks", () => {
  const m = getEvolutionMetric("after_hours_tasks");
  assert.equal(m.getValue(row()), 33);
});

test("getEvolutionMetric('rate'): lee after_hours_rate (0-1) y lo formatea como porcentaje", () => {
  const m = getEvolutionMetric("rate");
  assert.equal(m.getValue(row()), 0.1667);
  assert.equal(m.unit, "%");
  assert.equal(m.formatValue(0.1667), "16,7%");
});

test("getEvolutionMetric: cada métrica tiene un label accesible no vacío para el selector", () => {
  for (const metric of EVOLUTION_METRICS) {
    assert.ok(metric.label.length > 0);
  }
});
