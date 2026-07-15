import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInterval, CALCULATION_METHOD } from "../../src/working-hours/interval-resolver.js";

test("EXACT_REPORTED_START_END: hay fin reportado posterior al inicio", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedEndRaw: "2026-08-10T17:30:00Z", durationMinutes: 90 });
  assert.equal(r.method, CALCULATION_METHOD.EXACT_REPORTED_START_END);
  assert.equal(r.durationSeconds, 90 * 60);
  assert.equal(r.reasonCode, null);
});

test("ESTIMATED_FROM_START_DURATION: sin fin reportado, duración válida", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedEndRaw: null, durationMinutes: 45 });
  assert.equal(r.method, CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION);
  assert.equal(r.durationSeconds, 45 * 60);
  assert.equal(r.endTimeUtc.toISOString(), "2026-08-10T16:45:00.000Z");
});

test("ESTIMATED_FROM_START_DURATION: fin reportado anterior al inicio (dato inconsistente) cae a duración", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedEndRaw: "2026-08-10T15:00:00Z", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION);
});

test("INSUFFICIENT_DATA: inicio válido, sin fin ni duración", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedEndRaw: null, durationMinutes: null });
  assert.equal(r.method, CALCULATION_METHOD.INSUFFICIENT_DATA);
  assert.equal(r.reasonCode, "INSUFFICIENT_DATA");
  assert.equal(r.startTimeUtc, null);
});

test("INVALID_DURATION: inicio válido, duración presente pero <= 0", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedEndRaw: null, durationMinutes: 0 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_DURATION);
  assert.equal(r.reasonCode, "INVALID_DURATION");
});

test("INVALID_START_TIME: start_time no parseable", () => {
  const r = resolveInterval({ startTimeRaw: "no-es-una-fecha", reportedEndRaw: null, durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_START_TIME);
  assert.equal(r.reasonCode, "INVALID_START_TIME");
});

test("INVALID_START_TIME: start_time ausente", () => {
  const r = resolveInterval({ startTimeRaw: null, reportedEndRaw: "2026-08-10T17:00:00Z", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_START_TIME);
});
