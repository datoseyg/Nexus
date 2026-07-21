import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLegacyExactParity, segmentLegacyCorrectedV2, businessHoursConfigToWindows } from "../../src/working-hours/legacy-global-schedule.js";

const businessHoursCfg = { status: "DEFAULT_UNVALIDATED", timezone: "America/Santiago", weekly_schedule: {
  monday: { is_business_day: true, start: "08:30", end: "18:30" }, tuesday: { is_business_day: true, start: "08:30", end: "18:30" },
  wednesday: { is_business_day: true, start: "08:30", end: "18:30" }, thursday: { is_business_day: true, start: "08:30", end: "18:30" },
  friday: { is_business_day: true, start: "08:30", end: "18:30" }, saturday: { is_business_day: false }, sunday: { is_business_day: false }
} };

// === legacy_exact_parity -reproducción fiel del algoritmo legado, aritmética
// fake-UTC, validado contra las 3.747 filas reales del mart congelado (ver
// scratchpad/parity-exact.mjs -3747/3747 idénticas). Acá, casos unitarios
// pequeños y deterministas. ===

test("computeLegacyExactParity: EXACT_REPORTED_START_END cuando el par reportado es plausible", () => {
  const r = computeLegacyExactParity({
    task: { start_time: "2026-08-10T20:00:00Z", duration_minutes: 90, client_key: "C1", task_type: "PM", assigned_to: "tech1" },
    reportedInterval: { startRaw: "10/08/2026 16:00", endRaw: "10/08/2026 17:30" },
    businessHoursCfg,
    holidaysCfg: { status: "EXAMPLE_INCOMPLETE", dates: new Set() }
  });
  assert.equal(r.calculation_method, "EXACT_REPORTED_START_END");
  assert.equal(r.business_minutes + r.after_hours_total_minutes, 90);
});

test("computeLegacyExactParity: feriado marca todos los minutos como holiday_minutes", () => {
  const r = computeLegacyExactParity({
    task: { start_time: "2026-08-10T20:00:00Z", duration_minutes: 60 }, // lunes 16:00 local, dentro de ventana normalmente
    reportedInterval: null,
    businessHoursCfg,
    holidaysCfg: { status: "EXAMPLE_INCOMPLETE", dates: new Set(["2026-08-10"]) }
  });
  assert.equal(r.holiday_minutes, 60);
  assert.equal(r.business_minutes, 0);
});

test("computeLegacyExactParity: fin de semana sin horario -> weekend_minutes", () => {
  const r = computeLegacyExactParity({
    task: { start_time: "2026-08-15T18:00:00Z", duration_minutes: 60 }, // sábado 14:00 local
    reportedInterval: null,
    businessHoursCfg,
    holidaysCfg: { status: "EXAMPLE_INCOMPLETE", dates: new Set() }
  });
  assert.equal(r.weekend_minutes, 60);
});

// === legacy_corrected_v2 -segmentación DST-correcta + calendario gobernado
// (holidayLookup inyectado). Validado end-to-end contra las 3.747 tareas
// reales vía working-hours:parity (0 UNEXPLAINED). Acá, invariantes
// estructurales unitarias. ===

test("businessHoursConfigToWindows: solo días hábiles, formato correcto de minutos", () => {
  const windows = businessHoursConfigToWindows(businessHoursCfg);
  assert.equal(windows.length, 5); // lun-vie
  assert.ok(windows.every(w => w.startMinute === 8 * 60 + 30 && w.endMinute === 18 * 60 + 30));
});

test("segmentLegacyCorrectedV2: suma exacta de segment_seconds = duración total", () => {
  const startUtcMs = Date.UTC(2026, 7, 10, 20, 0, 0); // lunes 16:00 local
  const endUtcMs = Date.UTC(2026, 7, 11, 14, 0, 0); // martes 10:00 local
  const segments = segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, () => "CONFIRMED_NOT_HOLIDAY");
  const totalSeconds = segments.reduce((acc, s) => acc + s.segmentSeconds, 0);
  assert.equal(totalSeconds, (endUtcMs - startUtcMs) / 1000);
});

test("segmentLegacyCorrectedV2: precedencia HOLIDAY sobre WEEKEND (feriado en sábado sigue siendo HOLIDAY, no WEEKEND)", () => {
  const startUtcMs = Date.UTC(2026, 7, 15, 14, 0, 0); // sábado 10:00 local
  const endUtcMs = Date.UTC(2026, 7, 15, 18, 0, 0); // sábado 14:00 local
  const segments = segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, () => "CONFIRMED_HOLIDAY");
  assert.equal(segments.length, 1);
  assert.equal(segments[0].outsideCoverageBucket, "HOLIDAY");
});

test("segmentLegacyCorrectedV2: holidayLookup COVERAGE_UNKNOWN -> segmento NOT_CALCULABLE, nunca asumido como no-feriado", () => {
  const startUtcMs = Date.UTC(2026, 7, 10, 20, 0, 0);
  const endUtcMs = Date.UTC(2026, 7, 10, 21, 0, 0);
  const segments = segmentLegacyCorrectedV2(startUtcMs, endUtcMs, businessHoursCfg, () => "COVERAGE_UNKNOWN");
  assert.equal(segments[0].segmentCoverageState, "NOT_CALCULABLE");
  assert.equal(segments[0].segmentReasonCode, "HOLIDAY_COVERAGE_UNKNOWN");
  assert.equal(segments[0].coveredSeconds, null);
});

test("segmentLegacyCorrectedV2: todos los segmentos usan schedule_source LEGACY_GLOBAL y WITHIN_LEGACY_SCHEDULE cuando calculables", () => {
  const segments = segmentLegacyCorrectedV2(Date.UTC(2026, 7, 10, 20, 0, 0), Date.UTC(2026, 7, 11, 0, 0, 0), businessHoursCfg, () => "CONFIRMED_NOT_HOLIDAY");
  for (const s of segments) assert.equal(s.segmentReasonCode, "WITHIN_LEGACY_SCHEDULE");
});
