import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateSegments, isSuccessReasonCode } from "../../src/working-hours/coverage-aggregator.js";

function covered(seconds) { return { segmentCoverageState: "COVERED", segmentSeconds: seconds, coveredSeconds: seconds, outsideCoverageSeconds: 0, outsideCoverageBucket: null }; }
function outside(seconds, bucket) { return { segmentCoverageState: "OUTSIDE_COVERAGE", segmentSeconds: seconds, coveredSeconds: 0, outsideCoverageSeconds: seconds, outsideCoverageBucket: bucket }; }
function notCalculable() { return { segmentCoverageState: "NOT_CALCULABLE", segmentSeconds: 100, coveredSeconds: null, outsideCoverageSeconds: null, outsideCoverageBucket: null }; }

test("aggregateSegments: cualquier segmento NOT_CALCULABLE hace toda la agregación NOT_CALCULABLE", () => {
  const r = aggregateSegments([covered(100), notCalculable()]);
  assert.equal(r.calculable, false);
  assert.equal(r.coverageClassification, "NOT_CALCULABLE");
  assert.equal(r.coveredSeconds, null);
});

test("aggregateSegments: todo cubierto -> FULLY_COVERED, sin doble conteo", () => {
  const r = aggregateSegments([covered(3600), covered(1800)]);
  assert.equal(r.coverageClassification, "FULLY_COVERED");
  assert.equal(r.coveredSeconds, 5400);
  assert.equal(r.outsideCoverageSeconds, 0);
  assert.equal(r.isAfterHoursTask, false);
});

test("aggregateSegments: todo fuera -> NOT_COVERED", () => {
  const r = aggregateSegments([outside(3600, "WEEKEND")]);
  assert.equal(r.coverageClassification, "NOT_COVERED");
  assert.equal(r.coveredSeconds, 0);
  assert.equal(r.isAfterHoursTask, true);
});

test("aggregateSegments: mezcla cubierto/fuera -> PARTIALLY_COVERED, suma exacta = duración total", () => {
  const r = aggregateSegments([covered(3600), outside(1800, "AFTER_HOURS_WEEKDAY")]);
  assert.equal(r.coverageClassification, "PARTIALLY_COVERED");
  assert.equal(r.coveredSeconds + r.outsideCoverageSeconds, 5400);
});

test("aggregateSegments: buckets HOLIDAY/WEEKEND/AFTER_HOURS_WEEKDAY se acumulan por separado, sin solaparse", () => {
  const r = aggregateSegments([outside(100, "HOLIDAY"), outside(200, "WEEKEND"), outside(300, "AFTER_HOURS_WEEKDAY")]);
  assert.equal(r.holidaySeconds, 100);
  assert.equal(r.weekendSeconds, 200);
  assert.equal(r.afterHoursWeekdaySeconds, 300);
  assert.equal(r.afterHoursTotalSeconds, 600);
  assert.equal(r.afterHoursTotalSeconds, r.outsideCoverageSeconds, "outside_coverage_seconds = after_hours_total_seconds por construcción");
});

test("aggregateSegments: after_hours_rate redondeado a 4 decimales", () => {
  const r = aggregateSegments([covered(2), outside(1, "WEEKEND")]); // 1/3 = 0.3333...
  assert.equal(r.afterHoursRate, 0.3333);
});

test("aggregateSegments: duración cero -> after_hours_rate = 0 (sin división por cero)", () => {
  const r = aggregateSegments([]);
  assert.equal(r.afterHoursRate, 0);
  assert.equal(r.coverageClassification, "FULLY_COVERED"); // outsideCoverageSeconds=0 vacuamente
});

test("isSuccessReasonCode: WITHIN_LEGACY_SCHEDULE es éxito", () => {
  assert.equal(isSuccessReasonCode("WITHIN_LEGACY_SCHEDULE"), true);
});

test("isSuccessReasonCode: WITHIN_MATCHED_CONTRACT es éxito, EQUIPMENT_UNMATCHED no lo es", () => {
  assert.equal(isSuccessReasonCode("WITHIN_MATCHED_CONTRACT"), true);
  assert.equal(isSuccessReasonCode("EQUIPMENT_UNMATCHED"), false);
});
