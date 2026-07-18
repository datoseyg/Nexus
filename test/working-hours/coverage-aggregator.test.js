import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateSegments, isSuccessReasonCode, roundRateExact } from "../../src/working-hours/coverage-aggregator.js";

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

// === ETAPA 6.5.2B1.1 - roundRateExact: redondeo racional exacto (BigInt),
// determinista, sin punto flotante en ningún paso intermedio -reproduce
// EXACTAMENTE ROUND(numerator::numeric/denominator, 4) de PostgreSQL,
// incluida la regla de empate (round-half-up), a diferencia de
// Math.round(x*10000)/10000 que puede diferir por imprecisión binaria
// justo en el límite de un empate (caso real: tarea 464, ver reporte).

test("roundRateExact: caso real (tarea 464) -1809/7200 = 0.25125 exacto -> 0.2513 (PostgreSQL ROUND, no 0.2512 de Math.round flotante)", () => {
  assert.equal(roundRateExact(1809, 7200), 0.2513);
});

test("roundRateExact: mitad exacta -1/20000 = 0.00005 exacto (5º decimal = 5) -> redondea hacia arriba, 0.0001", () => {
  assert.equal(roundRateExact(1, 20000), 0.0001);
});

test("roundRateExact: inmediatamente inferior a la mitad -1/3 = 0.3333... (5º decimal = 3) -> conserva el 4º decimal inferior, 0.3333", () => {
  assert.equal(roundRateExact(1, 3), 0.3333);
});

test("roundRateExact: inmediatamente superior a la mitad -2/3 = 0.6666... (5º decimal = 6) -> redondea hacia arriba, 0.6667", () => {
  assert.equal(roundRateExact(2, 3), 0.6667);
});

test("roundRateExact: borde 0/duración -> 0", () => {
  assert.equal(roundRateExact(0, 7200), 0);
});

test("roundRateExact: borde duración/duración -> 1", () => {
  assert.equal(roundRateExact(7200, 7200), 1);
});

test("roundRateExact: denominador = 0 -> RangeError, ninguna división silenciosa", () => {
  assert.throws(() => roundRateExact(100, 0), RangeError);
});

test("roundRateExact: denominador negativo -> RangeError", () => {
  assert.throws(() => roundRateExact(100, -7200), RangeError);
});

test("roundRateExact: numerator negativo -> RangeError (segundos nunca son negativos en este dominio)", () => {
  assert.throws(() => roundRateExact(-1, 7200), RangeError);
});

test("roundRateExact: valores no enteros -> RangeError (nunca segundos fraccionarios)", () => {
  assert.throws(() => roundRateExact(1809.5, 7200), RangeError);
  assert.throws(() => roundRateExact(1809, 7200.5), RangeError);
});

test("roundRateExact: devuelve un number plano compatible con la escritura actual (no BigInt, no string)", () => {
  const r = roundRateExact(1809, 7200);
  assert.equal(typeof r, "number");
});

test("aggregateSegments: usa roundRateExact internamente -tarea 464 real (1809/7200) agregada como 1 solo segmento produce 0.2513, no 0.2512", () => {
  const r = aggregateSegments([covered(5391), outside(1809, "AFTER_HOURS_WEEKDAY")]);
  assert.equal(r.afterHoursRate, 0.2513);
});

test("isSuccessReasonCode: WITHIN_LEGACY_SCHEDULE es éxito", () => {
  assert.equal(isSuccessReasonCode("WITHIN_LEGACY_SCHEDULE"), true);
});

test("isSuccessReasonCode: WITHIN_MATCHED_CONTRACT es éxito, EQUIPMENT_UNMATCHED no lo es", () => {
  assert.equal(isSuccessReasonCode("WITHIN_MATCHED_CONTRACT"), true);
  assert.equal(isSuccessReasonCode("EQUIPMENT_UNMATCHED"), false);
});
