import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInterval, calculateConfidence, evaluateReportedInterval, parseChileWallClockToUtcMs, CALCULATION_METHOD } from "../../src/working-hours/interval-resolver.js";

// reportedStartRaw/reportedEndRaw usan el formato real de FieldBeat report_fields
// ("DD/MM/YYYY HH:mm", hora local Chile, sin marcador de zona) -verificado
// contra los 3.747 registros reales del mart congelado (parity-exact.mjs).

test("parseChileWallClockToUtcMs: formato válido -> instante UTC real (DST-correcto)", () => {
  const utcMs = parseChileWallClockToUtcMs("10/08/2026 16:00");
  assert.equal(new Date(utcMs).toISOString(), "2026-08-10T20:00:00.000Z"); // agosto = horario estándar Chile (GMT-4); DST 2026 corre ~sep-abr
});

test("parseChileWallClockToUtcMs: formato inválido -> null", () => {
  assert.equal(parseChileWallClockToUtcMs("2026-08-10 16:00"), null);
  assert.equal(parseChileWallClockToUtcMs(""), null);
  assert.equal(parseChileWallClockToUtcMs(null), null);
});

test("evaluateReportedInterval: lapso consistente con duration_minutes -> plausible", () => {
  const r = evaluateReportedInterval("10/08/2026 16:00", "10/08/2026 17:30", 90);
  assert.equal(r.plausible, true);
});

test("evaluateReportedInterval: fin anterior o igual al inicio -> no plausible", () => {
  const r = evaluateReportedInterval("10/08/2026 17:00", "10/08/2026 16:00", 60);
  assert.equal(r.plausible, false);
});

test("evaluateReportedInterval: lapso fuera de tolerancia (max(60, 0.5*duración)) -> no plausible", () => {
  const r = evaluateReportedInterval("10/08/2026 16:00", "10/08/2026 20:00", 30); // 240 min reportados vs 30 min duración, tolerancia=60
  assert.equal(r.plausible, false);
});

test("evaluateReportedInterval: lapso > 1440 min -> no plausible (cruza más de un día)", () => {
  const r = evaluateReportedInterval("10/08/2026 08:00", "12/08/2026 08:00", 2880);
  assert.equal(r.plausible, false);
});

test("resolveInterval: EXACT_REPORTED_START_END cuando el par reportado es plausible", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T19:00:00Z", reportedStartRaw: "10/08/2026 16:00", reportedEndRaw: "10/08/2026 17:30", durationMinutes: 90 });
  assert.equal(r.method, CALCULATION_METHOD.EXACT_REPORTED_START_END);
  assert.equal(r.durationSeconds, 90 * 60);
  assert.equal(r.reasonCode, null);
});

test("resolveInterval: ESTIMATED_FROM_START_DURATION sin par reportado, duración válida", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 45 });
  assert.equal(r.method, CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION);
  assert.equal(r.durationSeconds, 45 * 60);
  assert.equal(r.endTimeUtc.toISOString(), "2026-08-10T16:45:00.000Z");
});

test("resolveInterval: ESTIMATED_FROM_START_DURATION cuando el par reportado no es plausible", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedStartRaw: "10/08/2026 16:00", reportedEndRaw: "10/08/2026 15:00", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION);
});

test("resolveInterval: PARTIAL_ESTIMATE cuando duration_minutes es sospechosa (<5 o >=480 o =1440)", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 2 });
  assert.equal(r.method, CALCULATION_METHOD.PARTIAL_ESTIMATE);
  assert.equal(r.durationSeconds, 120);
});

test("resolveInterval: INSUFFICIENT_DATA cuando duration_minutes está ausente y no hay par reportado plausible", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: null });
  assert.equal(r.method, CALCULATION_METHOD.INSUFFICIENT_DATA);
  assert.equal(r.reasonCode, "INSUFFICIENT_DATA");
  assert.equal(r.startTimeUtc, null);
});

test("resolveInterval: INVALID_DURATION cuando duration_minutes está presente pero <= 0", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 0 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_DURATION);
  assert.equal(r.reasonCode, "INVALID_DURATION");
});

test("resolveInterval: INVALID_START_TIME cuando start_time no es parseable", () => {
  const r = resolveInterval({ startTimeRaw: "no-es-una-fecha", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_START_TIME);
  assert.equal(r.reasonCode, "INVALID_START_TIME");
});

test("resolveInterval: INVALID_START_TIME cuando start_time está ausente", () => {
  const r = resolveInterval({ startTimeRaw: null, durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_START_TIME);
});

test("resolveInterval: start_time_utc/end_time_utc quedan normalizados a whole-seconds (sql/081 lo exige)", () => {
  const r = resolveInterval({ startTimeRaw: "2026-08-10T16:00:00.513Z", durationMinutes: 45 });
  assert.equal(r.startTimeUtc.getTime() % 1000, 0);
  assert.equal(r.endTimeUtc.getTime() % 1000, 0);
});

// calculateConfidence -fórmula de 6 factores EXACTA a
// cloud-d1-readonly:src/lib/calculation-confidence.js (nunca el reescalado
// de 7 factores rechazado en 6.6A.1).

test("calculateConfidence: caso completo (todos los factores altos) -> score alto, tier Alta", () => {
  const r = calculateConfidence(
    { startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 60, clientKey: "C1", taskType: "PM", assignedTo: "tech1" },
    { businessHoursStatus: "VALIDATED", holidaysStatus: "VALIDATED", reportedEvaluation: { plausible: true } }
  );
  assert.equal(r.score, 100);
  assert.equal(r.label, "Alta");
});

test("calculateConfidence: sin start_time -> 0 puntos de ese factor", () => {
  const r = calculateConfidence({ startTimeRaw: null, durationMinutes: 60 }, {});
  assert.ok(r.factors.includes("start_time ausente o inválido (+0)"));
});

test("calculateConfidence: duration_minutes sospechosa -> 10 puntos (no 25)", () => {
  const r = calculateConfidence({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 2 }, {});
  assert.ok(r.factors.includes("duration_minutes sospechoso o extremo (+10)"));
});

test("calculateConfidence: businessHoursStatus DEFAULT_UNVALIDATED -> 8 puntos (no 15)", () => {
  const r = calculateConfidence({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 60 }, { businessHoursStatus: "DEFAULT_UNVALIDATED" });
  assert.ok(r.factors.includes("calendario laboral configurado pero sin validar con negocio (default) (+8)"));
});

test("calculateConfidence: holidaysStatus VALIDATED -> 10 puntos (calendario gobernado real de 6.6B1)", () => {
  const r = calculateConfidence({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 60 }, { holidaysStatus: "VALIDATED" });
  assert.ok(r.factors.includes("feriados validados con negocio (+10)"));
});

test("calculateConfidence: trazabilidad completa (cliente + 2 secundarios) -> 10 puntos", () => {
  const r = calculateConfidence({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 60, clientKey: "C1", taskType: "PM", assignedTo: "tech1" }, {});
  assert.ok(r.factors.includes("trazabilidad completa (cliente, tipo de tarea, técnico) (+10)"));
});
