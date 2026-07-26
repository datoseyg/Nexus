import { test } from "node:test";
import assert from "node:assert/strict";
import { n, percentage } from "../../lib/fieldbeat-quality-queries.ts";

// Phase 3 reapertura §4 - reemplaza (con un riesgo distinto, ver comentario
// en fieldbeat-quality-queries.ts) parte de la cobertura que tenía el viejo
// contract.test.ts (parseCount, 11 tests) sobre la coerción numérica
// server-side que reemplazó al parser client-side retirado.

test("n(): null/undefined -> 0, nunca NaN", () => {
  assert.equal(n(null), 0);
  assert.equal(n(undefined), 0);
});

test("n(): string decimal de Postgres (BIGINT/COUNT) -> number", () => {
  assert.equal(n("3747"), 3747);
  assert.equal(n("0"), 0);
});

test("n(): ya viene como number -> pasa igual", () => {
  assert.equal(n(42), 42);
});

test("percentage(): denominador <= 0 -> null, nunca NaN/Infinity", () => {
  assert.equal(percentage(5, 0), null);
  assert.equal(percentage(5, -1), null);
});

test("percentage(): calcula con 2 decimales", () => {
  assert.equal(percentage(2845, 3609), 78.83);
  assert.equal(percentage(1, 3), 33.33);
});

test("percentage(): 0/N es 0, no null (denominador real, numerador legítimamente cero)", () => {
  assert.equal(percentage(0, 100), 0);
});
