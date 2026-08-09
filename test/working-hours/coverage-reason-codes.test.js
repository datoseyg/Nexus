import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEDULE_SOURCE,
  SEGMENT_REASON_CODES,
  CAPA_C_REASON_CODES,
  CONTRACTUAL_REASON_CODES,
  CONTRACTUAL_SUCCESS_REASON_CODES,
  INTERVAL_TERMINAL_REASON_CODES,
  isSegmentReasonCodeValidForSource,
  isIntervalTerminal,
  isContractualSuccess,
  resolveOutsideCoverageBucket,
  HOLIDAY_COVERAGE_STATUS,
  OUTSIDE_COVERAGE_BUCKET
} from "../../src/working-hours/coverage-reason-codes.js";

test("SEGMENT_REASON_CODES tiene exactamente 12 códigos", () => {
  assert.equal(SEGMENT_REASON_CODES.length, 12);
});

test("CAPA_C_REASON_CODES tiene exactamente 18 códigos", () => {
  assert.equal(CAPA_C_REASON_CODES.length, 18);
});

test("CONTRACTUAL_REASON_CODES excluye WITHIN_LEGACY_SCHEDULE (17 códigos)", () => {
  assert.equal(CONTRACTUAL_REASON_CODES.length, 17);
  assert.ok(!CONTRACTUAL_REASON_CODES.includes("WITHIN_LEGACY_SCHEDULE"));
});

test("matriz schedule_source: LEGACY_GLOBAL solo admite WITHIN_LEGACY_SCHEDULE y HOLIDAY_COVERAGE_UNKNOWN", () => {
  for (const code of SEGMENT_REASON_CODES) {
    const valid = isSegmentReasonCodeValidForSource(code, SCHEDULE_SOURCE.LEGACY_GLOBAL);
    const expected = code === "WITHIN_LEGACY_SCHEDULE" || code === "HOLIDAY_COVERAGE_UNKNOWN";
    assert.equal(valid, expected, `código ${code} bajo LEGACY_GLOBAL`);
  }
});

test("matriz schedule_source: CONTRACT nunca admite WITHIN_LEGACY_SCHEDULE", () => {
  assert.equal(isSegmentReasonCodeValidForSource("WITHIN_LEGACY_SCHEDULE", SCHEDULE_SOURCE.CONTRACT), false);
  assert.equal(isSegmentReasonCodeValidForSource("WITHIN_MATCHED_CONTRACT", SCHEDULE_SOURCE.CONTRACT), true);
  assert.equal(isSegmentReasonCodeValidForSource("EQUIPMENT_UNMATCHED", SCHEDULE_SOURCE.CONTRACT), true);
});

test("isIntervalTerminal reconoce los 3 motivos terminales de intervalo", () => {
  for (const code of INTERVAL_TERMINAL_REASON_CODES) {
    assert.equal(isIntervalTerminal(code), true);
  }
  assert.equal(isIntervalTerminal("WITHIN_MATCHED_CONTRACT"), false);
  assert.equal(isIntervalTerminal("NO_EQUIPMENT"), false);
});

test("isContractualSuccess reconoce los 2 códigos de éxito contractual", () => {
  for (const code of CONTRACTUAL_SUCCESS_REASON_CODES) {
    assert.equal(isContractualSuccess(code), true);
  }
  assert.equal(isContractualSuccess("NO_EQUIPMENT"), false);
  assert.equal(isContractualSuccess("WITHIN_LEGACY_SCHEDULE"), false);
});

test("resolveOutsideCoverageBucket: feriado confirmado siempre gana (precedencia HOLIDAY > WEEKEND)", () => {
  const bucket = resolveOutsideCoverageBucket({ holidayCoverageStatus: HOLIDAY_COVERAGE_STATUS.CONFIRMED_HOLIDAY, dayOfWeek: "SAT" });
  assert.equal(bucket, OUTSIDE_COVERAGE_BUCKET.HOLIDAY);
});

test("resolveOutsideCoverageBucket: fin de semana no feriado -> WEEKEND", () => {
  const bucket = resolveOutsideCoverageBucket({ holidayCoverageStatus: HOLIDAY_COVERAGE_STATUS.CONFIRMED_NOT_HOLIDAY, dayOfWeek: "SUN" });
  assert.equal(bucket, OUTSIDE_COVERAGE_BUCKET.WEEKEND);
});

test("resolveOutsideCoverageBucket: día hábil no feriado -> AFTER_HOURS_WEEKDAY", () => {
  const bucket = resolveOutsideCoverageBucket({ holidayCoverageStatus: HOLIDAY_COVERAGE_STATUS.CONFIRMED_NOT_HOLIDAY, dayOfWeek: "WED" });
  assert.equal(bucket, OUTSIDE_COVERAGE_BUCKET.AFTER_HOURS_WEEKDAY);
});

test("resolveOutsideCoverageBucket: COVERAGE_UNKNOWN nunca debe llegar acá -lanza", () => {
  assert.throws(() => resolveOutsideCoverageBucket({ holidayCoverageStatus: HOLIDAY_COVERAGE_STATUS.COVERAGE_UNKNOWN, dayOfWeek: "MON" }));
});
