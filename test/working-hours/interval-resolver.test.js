import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveReportAnalysisInterval,
  calculateConfidence,
  parseFieldbeatDateTime,
  ANALYSIS_INTERVAL_BASIS,
  CALCULATION_METHOD
} from "../../src/working-hours/interval-resolver.js";

// reportedStartRaw/reportedEndRaw usan el formato real de FieldBeat report_fields
// ("DD/MM/YYYY HH:mm", hora local Chile, sin marcador de zona) -verificado
// contra los 3.747 registros reales del mart congelado (parity-exact.mjs).

test("parseFieldbeatDateTime: conserva procedencia y normaliza DD/MM/YYYY HH:mm en America/Santiago", () => {
  const parsed = parseFieldbeatDateTime("10/08/2026 16:00", "HORA DE INICIO DEL TRABAJO");
  assert.equal(parsed.value.toISOString(), "2026-08-10T20:00:00.000Z");
  assert.equal(parsed.rawValue, "10/08/2026 16:00");
  assert.equal(parsed.source, "FORM_FIELD");
  assert.equal(parsed.sourceField, "HORA DE INICIO DEL TRABAJO");
  assert.equal(parsed.parseStatus, "PARSED");
});

test("parseFieldbeatDateTime: valida calendario, bisiesto, hora, vacío y espacios", () => {
  assert.equal(parseFieldbeatDateTime("29/02/2024 08:05", "X").parseStatus, "PARSED");
  assert.equal(parseFieldbeatDateTime("29/02/2025 08:05", "X").parseStatus, "INVALID");
  assert.equal(parseFieldbeatDateTime("31/04/2026 08:05", "X").parseStatus, "INVALID");
  assert.equal(parseFieldbeatDateTime("10/08/2026 24:00", "X").parseStatus, "INVALID");
  assert.equal(parseFieldbeatDateTime("2026-08-10 16:00", "X").parseStatus, "INVALID");
  assert.equal(parseFieldbeatDateTime("", "X").parseStatus, "MISSING");
  assert.equal(parseFieldbeatDateTime(null, "X").parseStatus, "MISSING");
  assert.equal(parseFieldbeatDateTime("  10/08/2026   16:00  ", "X").parseStatus, "PARSED");
});

test("parseFieldbeatDateTime: una hora ambigua por DST queda tipada y no se acepta silenciosamente", () => {
  const parsed = parseFieldbeatDateTime("04/04/2026 23:30", "X");
  assert.equal(parsed.parseStatus, "AMBIGUOUS");
});

test("resolveReportAnalysisInterval: el par informado válido siempre prevalece sobre programación y estimación", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T19:00:00Z", reportedStartRaw: "10/08/2026 16:00", reportedEndRaw: "10/08/2026 20:00", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.EXACT_REPORTED_START_END);
  assert.equal(r.durationSeconds, 240 * 60);
  assert.equal(r.analysisIntervalBasis, ANALYSIS_INTERVAL_BASIS.REPORTED_WORK_INTERVAL);
  assert.equal(r.analysisFallbackUsed, false);
  assert.equal(r.reasonCode, null);
});

test("resolveReportAnalysisInterval: caso real 3824 conserva 41 h 11 min aunque cruce día y anteceda a la programación", () => {
  const r = resolveReportAnalysisInterval({
    startTimeRaw: "2026-07-31T23:01:00.000Z",
    reportedStartRaw: "30/07/2026 06:02",
    reportedEndRaw: "31/07/2026 23:13",
    deliveredRaw: "31/07/2026 23:15",
    durationMinutes: 120,
    reportRegisteredAt: "2026-07-31T23:01:39.237Z"
  });
  assert.equal(r.startTimeUtc.toISOString(), "2026-07-30T10:02:00.000Z");
  assert.equal(r.endTimeUtc.toISOString(), "2026-08-01T03:13:00.000Z");
  assert.equal(r.durationSeconds, 2471 * 60);
  assert.equal(r.analysisIntervalBasis, ANALYSIS_INTERVAL_BASIS.REPORTED_WORK_INTERVAL);
  assert.equal(r.analysisFallbackUsed, false);
  assert.deepEqual(r.temporalIssues, []);
});

test("resolveReportAnalysisInterval: SCHEDULED_ESTIMATE sin par reportado, duración válida", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 45 });
  assert.equal(r.method, CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION);
  assert.equal(r.durationSeconds, 45 * 60);
  assert.equal(r.endTimeUtc.toISOString(), "2026-08-10T16:45:00.000Z");
  assert.equal(r.analysisIntervalBasis, ANALYSIS_INTERVAL_BASIS.SCHEDULED_ESTIMATE);
  assert.equal(r.analysisFallbackUsed, true);
  assert.equal(r.analysisFallbackReason, "REPORTED_INTERVAL_MISSING");
});

test("resolveReportAnalysisInterval: fin informado anterior al inicio genera contradicción objetiva y fallback gobernado", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00Z", reportedStartRaw: "10/08/2026 16:00", reportedEndRaw: "10/08/2026 15:00", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.ESTIMATED_FROM_START_DURATION);
  assert.equal(r.analysisFallbackReason, "REPORTED_WORK_END_PRECEDES_START");
  assert.deepEqual(r.temporalIssues, ["REPORTED_WORK_END_PRECEDES_START"]);
});

test("resolveReportAnalysisInterval: intervalo informado incompleto genera issue y fallback gobernado", () => {
  for (const input of [
    { reportedStartRaw: "10/08/2026 16:00", reportedEndRaw: null },
    { reportedStartRaw: null, reportedEndRaw: "10/08/2026 17:00" }
  ]) {
    const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 30, ...input });
    assert.equal(r.analysisFallbackReason, "REPORTED_INTERVAL_INCOMPLETE");
    assert.deepEqual(r.temporalIssues, ["REPORTED_INTERVAL_INCOMPLETE"]);
  }
});

test("resolveInterval: PARTIAL_ESTIMATE cuando duration_minutes es sospechosa (<5 o >=480 o =1440)", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 2 });
  assert.equal(r.method, CALCULATION_METHOD.PARTIAL_ESTIMATE);
  assert.equal(r.durationSeconds, 120);
});

test("resolveInterval: INSUFFICIENT_DATA cuando duration_minutes está ausente y no hay par reportado plausible", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: null });
  assert.equal(r.method, CALCULATION_METHOD.INSUFFICIENT_DATA);
  assert.equal(r.reasonCode, "INSUFFICIENT_DATA");
  assert.equal(r.startTimeUtc, null);
});

test("resolveInterval: INVALID_DURATION cuando duration_minutes está presente pero <= 0", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00Z", durationMinutes: 0 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_DURATION);
  assert.equal(r.reasonCode, "INVALID_DURATION");
});

test("resolveInterval: INVALID_START_TIME cuando start_time no es parseable", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "no-es-una-fecha", durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_START_TIME);
  assert.equal(r.reasonCode, "INVALID_START_TIME");
});

test("resolveInterval: INVALID_START_TIME cuando start_time está ausente", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: null, durationMinutes: 30 });
  assert.equal(r.method, CALCULATION_METHOD.INVALID_START_TIME);
});

test("resolveInterval: start_time_utc/end_time_utc quedan normalizados a whole-seconds (sql/081 lo exige)", () => {
  const r = resolveReportAnalysisInterval({ startTimeRaw: "2026-08-10T16:00:00.513Z", durationMinutes: 45 });
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
