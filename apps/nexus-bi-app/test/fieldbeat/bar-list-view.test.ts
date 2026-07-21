import { test } from "node:test";
import assert from "node:assert/strict";
import { barWidthPct, maxOf } from "../../lib/fieldbeat-bar-list-view.ts";

test("barWidthPct: 0 en value=0", () => {
  assert.equal(barWidthPct(0, 100), 0);
});

test("barWidthPct: 100 en value=maxValue", () => {
  assert.equal(barWidthPct(50, 50), 100);
});

test("barWidthPct: proporcional entre 0 y maxValue", () => {
  assert.equal(barWidthPct(25, 100), 25);
});

test("barWidthPct: clamped a 100 si value > maxValue (nunca desborda la barra)", () => {
  assert.equal(barWidthPct(150, 100), 100);
});

test("barWidthPct: 0 si maxValue <= 0 (nunca división por cero/negativa)", () => {
  assert.equal(barWidthPct(10, 0), 0);
  assert.equal(barWidthPct(10, -5), 0);
});

test("maxOf: máximo de una lista no vacía", () => {
  assert.equal(maxOf([3, 7, 1]), 7);
});

test("maxOf: 0 en lista vacía (nunca -Infinity)", () => {
  assert.equal(maxOf([]), 0);
});

test("maxOf: nunca negativo aunque todos los valores lo sean", () => {
  assert.equal(maxOf([-3, -7, -1]), 0);
});
