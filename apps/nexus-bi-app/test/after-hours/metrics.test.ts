import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculableExpr,
  confidenceEligibilityCountExprs,
  confidenceWeightedExpr,
  populationCountExprs,
  populationSelectListSql,
  rateExpr,
  resolveEstimatedEndTime,
  sumMinutesExpr
} from "../../lib/after-hours-metrics.ts";

// === Poblaciones (§5) ===

test("calculableExpr: exactamente CONTRACTUAL o LEGACY_SCHEDULE, nunca NONE", () => {
  const expr = calculableExpr("w");
  assert.equal(expr, "w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE')");
});

test("populationCountExprs: las 7 poblaciones estándar están presentes", () => {
  const exprs = populationCountExprs("w");
  assert.deepEqual(Object.keys(exprs).sort(), [
    "calculable_tasks",
    "contractual_tasks",
    "fallback_tasks",
    "legacy_schedule_tasks",
    "none_tasks",
    "not_calculable_tasks",
    "total_tasks"
  ]);
});

test("populationCountExprs: not_calculable_tasks y none_tasks son la MISMA expresión (data_basis='NONE'), por construcción (§5/§8 mismo concepto, distinto nombre)", () => {
  const exprs = populationCountExprs("w");
  assert.equal(exprs.not_calculable_tasks, exprs.none_tasks);
});

test("populationCountExprs: total_tasks es COUNT(*) sin filtro -toda fila filtrada cuenta, incluida NONE", () => {
  const exprs = populationCountExprs("w");
  assert.equal(exprs.total_tasks, "COUNT(*)");
});

test("populationSelectListSql: produce una lista válida 'expr AS nombre' por cada población", () => {
  const sql = populationSelectListSql("w");
  assert.ok(sql.includes("AS total_tasks"));
  assert.ok(sql.includes("AS calculable_tasks"));
  assert.ok(sql.includes("AS fallback_tasks"));
});

// === Tasa agregada (§9: SUM/SUM, nunca promedio de tasas por fila) ===

test("rateExpr: SUM/NULLIF(SUM,0), ambos lados filtrados a la misma población calculable", () => {
  const expr = rateExpr("w", "after_hours_total_minutes", "duration_minutes");
  assert.ok(expr.includes("SUM(w.after_hours_total_minutes) FILTER (WHERE w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE'))"));
  assert.ok(expr.includes("NULLIF(SUM(w.duration_minutes) FILTER (WHERE w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE')), 0)"));
});

test("sumMinutesExpr: filtra explícitamente a la población calculable, no confía solo en que la columna sea NULL para NONE", () => {
  const expr = sumMinutesExpr("w", "duration_minutes");
  assert.equal(expr, "SUM(w.duration_minutes) FILTER (WHERE w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE'))");
});

// === Confianza NULL-safe (§6.2) ===

test("confidenceWeightedExpr: numerador y denominador comparten EXACTAMENTE el mismo filtro de elegibilidad", () => {
  const { sql, eligibleExpr } = confidenceWeightedExpr("w");
  const needle = `FILTER (WHERE ${eligibleExpr})`;
  const occurrences = sql.split(needle).length - 1;
  assert.equal(occurrences, 2, `se esperaban 2 apariciones idénticas de "${needle}" en: ${sql}`);
});

test("confidenceWeightedExpr: la elegibilidad exige calculable + confidence_score no nulo + duration_minutes no nulo y > 0", () => {
  const { eligibleExpr } = confidenceWeightedExpr("w");
  assert.ok(eligibleExpr.includes("w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE')"));
  assert.ok(eligibleExpr.includes("w.confidence_score IS NOT NULL"));
  assert.ok(eligibleExpr.includes("w.duration_minutes IS NOT NULL"));
  assert.ok(eligibleExpr.includes("w.duration_minutes > 0"));
});

test("confidenceEligibilityCountExprs: eligible y excluded usan el mismo filtro base de elegibilidad, con polaridad opuesta", () => {
  const { eligible, excluded } = confidenceEligibilityCountExprs("w");
  const { eligibleExpr } = confidenceWeightedExpr("w");
  assert.ok(eligible.includes(eligibleExpr));
  assert.ok(excluded.includes(`NOT (${eligibleExpr})`));
  // excluded está acotado a la población calculable -una fila NONE nunca
  // "pierde" un score que nunca se le exigió.
  assert.ok(excluded.includes(calculableExpr("w")));
});

// === Branching temporal del detail (§6.4) ===

test("resolveEstimatedEndTime: EXACT_REPORTED_START_END muestra reported_end_raw tal cual", () => {
  assert.equal(resolveEstimatedEndTime("EXACT_REPORTED_START_END", "10/08/2026 17:30", "2026-08-10T17:00:00"), "10/08/2026 17:30");
});

test("resolveEstimatedEndTime: otros métodos usan end_time_local normalizado", () => {
  assert.equal(resolveEstimatedEndTime("ESTIMATED_FROM_START_DURATION", "algo raro", "2026-08-10T17:00:00"), "2026-08-10T17:00:00");
});

test("resolveEstimatedEndTime: EXACT_REPORTED_START_END con reported_end_raw NULL -> NULL (nunca cae a end_time_local silenciosamente)", () => {
  assert.equal(resolveEstimatedEndTime("EXACT_REPORTED_START_END", null, "2026-08-10T17:00:00"), null);
});

test("resolveEstimatedEndTime: sin end_time_local (NONE terminal) -> NULL, nunca inventa un valor", () => {
  assert.equal(resolveEstimatedEndTime("INSUFFICIENT_DATA", null, null), null);
});
