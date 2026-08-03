import { test } from "node:test";
import assert from "node:assert/strict";
import { mapServiceWindowRowsToCoverageSchedule, type RawServiceWindowRow } from "../../lib/contract-coverage-schedule.ts";

const VALIDITY = { validFrom: "2024-01-01", validTo: null };

function scheduleRow(overrides: Partial<RawServiceWindowRow>): RawServiceWindowRow {
  return {
    coverage_type: "FULL_24X7",
    coverage_condition: null,
    parse_status: "OK",
    timezone: "America/Santiago",
    service_window_id: null,
    day_of_week: null,
    start_time: null,
    end_time: null,
    all_day: null,
    includes_holidays: null,
    ...overrides
  };
}

// Bloque 2 NEXUS V3 - mapServiceWindowRowsToCoverageSchedule() es el único
// lugar que transforma filas crudas de config.contract_service_window_analysis
// en ContractCoverageSchedule - ambos consumidores (Contratos, Reportes/
// After-Hours) le pasan el mismo shape de fila.

test("FULL_24X7 con una sola fila de cero ventanas (LEFT JOIN, service_window_id NULL) -> windows: [], nunca 'schedule inexistente'", () => {
  const schedule = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: "FULL_24X7" })], VALIDITY);
  assert.equal(schedule.coverageType, "FULL_24X7");
  assert.deepEqual(schedule.windows, []);
  assert.equal(schedule.coversWeekends, true);
  assert.equal(schedule.coversHolidays, true);
});

test("orden de ventanas es Lun->Dom, nunca alfabético (alfabético daría FRI,MON,SAT,SUN,THU,TUE,WED)", () => {
  const rows: RawServiceWindowRow[] = [
    scheduleRow({ coverage_type: "FIXED_WINDOW", service_window_id: 1, day_of_week: "FRI", start_time: "08:00:00", end_time: "17:00:00", all_day: false, includes_holidays: false }),
    scheduleRow({ coverage_type: "FIXED_WINDOW", service_window_id: 2, day_of_week: "MON", start_time: "08:00:00", end_time: "17:00:00", all_day: false, includes_holidays: false }),
    scheduleRow({ coverage_type: "FIXED_WINDOW", service_window_id: 3, day_of_week: "WED", start_time: "08:00:00", end_time: "17:00:00", all_day: false, includes_holidays: false })
  ];
  const schedule = mapServiceWindowRowsToCoverageSchedule(rows, VALIDITY);
  assert.deepEqual(
    schedule.windows.map(w => w.dayOfWeek),
    ["MON", "WED", "FRI"]
  );
});

test("FIXED_WINDOW: coversWeekends true solo si hay una ventana SAT/SUN real, coversHolidays true solo si alguna ventana lo marca", () => {
  const withWeekend = mapServiceWindowRowsToCoverageSchedule(
    [
      scheduleRow({ coverage_type: "FIXED_WINDOW", service_window_id: 1, day_of_week: "MON", start_time: "08:00:00", end_time: "17:00:00", all_day: false, includes_holidays: false }),
      scheduleRow({ coverage_type: "FIXED_WINDOW", service_window_id: 2, day_of_week: "SAT", start_time: "09:00:00", end_time: "13:00:00", all_day: false, includes_holidays: true })
    ],
    VALIDITY
  );
  assert.equal(withWeekend.coversWeekends, true);
  assert.equal(withWeekend.coversHolidays, true);

  const withoutWeekend = mapServiceWindowRowsToCoverageSchedule(
    [scheduleRow({ coverage_type: "FIXED_WINDOW", service_window_id: 1, day_of_week: "MON", start_time: "08:00:00", end_time: "17:00:00", all_day: false, includes_holidays: false })],
    VALIDITY
  );
  assert.equal(withoutWeekend.coversWeekends, false);
  assert.equal(withoutWeekend.coversHolidays, false);
});

test("BUSINESS_HOURS_UNDEFINED/ON_DEMAND/NOT_COVERED/NOT_APPLICABLE/UNKNOWN -> coversWeekends/coversHolidays null, nunca false por defecto", () => {
  for (const coverageType of ["BUSINESS_HOURS_UNDEFINED", "ON_DEMAND", "NOT_COVERED", "NOT_APPLICABLE", "UNKNOWN"]) {
    const schedule = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: coverageType })], VALIDITY);
    assert.equal(schedule.coversWeekends, null, `coverageType=${coverageType}`);
    assert.equal(schedule.coversHolidays, null, `coverageType=${coverageType}`);
  }
});

test("CRITICAL_ONLY_24X7 -> coversWeekends/coversHolidays true (cubre el horario; la restricción es de criticidad, no de horario)", () => {
  const schedule = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: "CRITICAL_ONLY_24X7" })], VALIDITY);
  assert.equal(schedule.coversWeekends, true);
  assert.equal(schedule.coversHolidays, true);
});

test("effectiveFrom/effectiveTo vienen de la versión exacta pasada por el caller, nunca recalculados", () => {
  const schedule = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: "FULL_24X7" })], { validFrom: "2020-05-01", validTo: "2023-12-31" });
  assert.equal(schedule.effectiveFrom, "2020-05-01");
  assert.equal(schedule.effectiveTo, "2023-12-31");
});

test("parse_status REVIEW_REQUIRED se preserva; cualquier otro valor colapsa a OK (nunca lanza)", () => {
  const review = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: "BUSINESS_HOURS_UNDEFINED", parse_status: "REVIEW_REQUIRED" })], VALIDITY);
  assert.equal(review.parseStatus, "REVIEW_REQUIRED");

  const ok = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: "FULL_24X7", parse_status: "OK" })], VALIDITY);
  assert.equal(ok.parseStatus, "OK");
});

test("coverage_type no reconocido (esquema nuevo no reflejado acá) cae a UNKNOWN, nunca lanza", () => {
  const schedule = mapServiceWindowRowsToCoverageSchedule([scheduleRow({ coverage_type: "SOME_FUTURE_TYPE" })], VALIDITY);
  assert.equal(schedule.coverageType, "UNKNOWN");
});
