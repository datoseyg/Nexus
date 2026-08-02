import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidAfterHoursDateRange } from "../../lib/after-hours-filter-state.ts";

test("isValidAfterHoursDateRange: solo Desde -> válido", () => {
  assert.equal(isValidAfterHoursDateRange("2026-01-01", undefined), true);
});

test("isValidAfterHoursDateRange: solo Hasta -> válido", () => {
  assert.equal(isValidAfterHoursDateRange(undefined, "2026-01-01"), true);
});

test("isValidAfterHoursDateRange: ninguno -> válido", () => {
  assert.equal(isValidAfterHoursDateRange(undefined, undefined), true);
});

test("isValidAfterHoursDateRange: Desde < Hasta -> válido", () => {
  assert.equal(isValidAfterHoursDateRange("2026-01-01", "2026-01-31"), true);
});

test("isValidAfterHoursDateRange: Desde === Hasta -> válido (rango de un solo día)", () => {
  assert.equal(isValidAfterHoursDateRange("2026-01-15", "2026-01-15"), true);
});

test("isValidAfterHoursDateRange: Desde > Hasta -> inválido", () => {
  assert.equal(isValidAfterHoursDateRange("2026-02-01", "2026-01-01"), false);
});
