import { test } from "node:test";
import assert from "node:assert/strict";
import { readAfterHoursDateRangeFromUrl, buildAfterHoursUrlQuery } from "../../lib/after-hours-url-state.ts";

test("readAfterHoursDateRangeFromUrl: lee from y to presentes", () => {
  const range = readAfterHoursDateRangeFromUrl(new URLSearchParams("from=2026-01-01&to=2026-01-31"));
  assert.deepEqual(range, { from: "2026-01-01", to: "2026-01-31" });
});

test("readAfterHoursDateRangeFromUrl: ausentes -> undefined, nunca cadena vacía", () => {
  const range = readAfterHoursDateRangeFromUrl(new URLSearchParams(""));
  assert.deepEqual(range, { from: undefined, to: undefined });
});

test("readAfterHoursDateRangeFromUrl: solo from (solo Desde es válido)", () => {
  const range = readAfterHoursDateRangeFromUrl(new URLSearchParams("from=2026-01-01"));
  assert.deepEqual(range, { from: "2026-01-01", to: undefined });
});

test("buildAfterHoursUrlQuery: ambos -> ambos params", () => {
  assert.equal(buildAfterHoursUrlQuery({ from: "2026-01-01", to: "2026-01-31" }), "from=2026-01-01&to=2026-01-31");
});

test("buildAfterHoursUrlQuery: ninguno -> cadena vacía (nunca ?from=&to=)", () => {
  assert.equal(buildAfterHoursUrlQuery({}), "");
});

test("buildAfterHoursUrlQuery + readAfterHoursDateRangeFromUrl: round-trip", () => {
  const original = { from: "2026-03-01", to: "2026-03-15" };
  const restored = readAfterHoursDateRangeFromUrl(new URLSearchParams(buildAfterHoursUrlQuery(original)));
  assert.deepEqual(restored, original);
});
