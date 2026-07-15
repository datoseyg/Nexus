import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeIntervals,
  canonicalizeIntervals,
  computeCoverageFingerprint,
  EMPTY_COVERAGE_FINGERPRINT,
  evaluateMultiEquipmentEquivalence
} from "../../src/working-hours/equipment-coverage-equivalence.js";

test("mergeIntervals fusiona intervalos solapados/adyacentes", () => {
  const merged = mergeIntervals([
    { startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") },
    { startUtc: new Date("2026-08-10T20:30:00Z"), endUtc: new Date("2026-08-10T22:00:00Z") }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].startUtc.toISOString(), "2026-08-10T20:00:00.000Z");
  assert.equal(merged[0].endUtc.toISOString(), "2026-08-10T22:00:00.000Z");
});

test("mergeIntervals conserva intervalos separados sin fusionar", () => {
  const merged = mergeIntervals([
    { startUtc: new Date("2026-08-11T08:00:00Z"), endUtc: new Date("2026-08-11T10:00:00Z") },
    { startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].startUtc.toISOString(), "2026-08-10T20:00:00.000Z");
});

test("un equipo totalmente descubierto produce el fingerprint vacío constante", () => {
  assert.equal(computeCoverageFingerprint([]), EMPTY_COVERAGE_FINGERPRINT);
});

test("canonicalizeIntervals produce el mismo string para el mismo conjunto lógico, en cualquier orden de entrada", () => {
  const a = mergeIntervals([
    { startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") },
    { startUtc: new Date("2026-08-11T08:00:00Z"), endUtc: new Date("2026-08-11T10:00:00Z") }
  ]);
  const b = mergeIntervals([
    { startUtc: new Date("2026-08-11T08:00:00Z"), endUtc: new Date("2026-08-11T10:00:00Z") },
    { startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") }
  ]);
  assert.equal(canonicalizeIntervals(a), canonicalizeIntervals(b));
});

test("0 equipos -> NO_EQUIPMENT", () => {
  const r = evaluateMultiEquipmentEquivalence([]);
  assert.equal(r.outcome, "NO_EQUIPMENT");
  assert.equal(r.primaryEquipmentKey, null);
});

test("1 equipo calculable -> SINGLE_EQUIPMENT, es su propio primario", () => {
  const r = evaluateMultiEquipmentEquivalence([{ fieldbeatEquipmentKey: "FB-LINAC-001", coverageFingerprint: "abc", calculable: true }]);
  assert.equal(r.outcome, "SINGLE_EQUIPMENT");
  assert.equal(r.primaryEquipmentKey, "FB-LINAC-001");
});

test("1 equipo no calculable -> SINGLE_EQUIPMENT, sin primario", () => {
  const r = evaluateMultiEquipmentEquivalence([{ fieldbeatEquipmentKey: "FB-TPS-999", coverageFingerprint: null, calculable: false }]);
  assert.equal(r.outcome, "SINGLE_EQUIPMENT");
  assert.equal(r.primaryEquipmentKey, null);
});

test("caso A del ejemplo trabajado: LINAC calculable + TPS no calculable -> MULTIPLE_EQUIPMENT_CONFLICT", () => {
  const linacFingerprint = computeCoverageFingerprint([
    { startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") },
    { startUtc: new Date("2026-08-11T11:00:00Z"), endUtc: new Date("2026-08-11T13:00:00Z") }
  ]);
  const r = evaluateMultiEquipmentEquivalence([
    { fieldbeatEquipmentKey: "FB-LINAC-001", coverageFingerprint: linacFingerprint, calculable: true },
    { fieldbeatEquipmentKey: "FB-TPS-999", coverageFingerprint: null, calculable: false }
  ]);
  assert.equal(r.outcome, "MULTIPLE_EQUIPMENT_CONFLICT");
  assert.equal(r.primaryEquipmentKey, null);
});

test("caso B del ejemplo trabajado: 2 equipos con fingerprint idéntico -> MULTIPLE_EQUIPMENT_SAME_COVERAGE", () => {
  const sharedIntervals = [
    { startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") },
    { startUtc: new Date("2026-08-11T11:00:00Z"), endUtc: new Date("2026-08-11T13:00:00Z") }
  ];
  const fpA = computeCoverageFingerprint(sharedIntervals);
  const fpB = computeCoverageFingerprint(sharedIntervals);
  assert.equal(fpA, fpB);

  const r = evaluateMultiEquipmentEquivalence([
    { fieldbeatEquipmentKey: "FB-LINAC-002", coverageFingerprint: fpB, calculable: true },
    { fieldbeatEquipmentKey: "FB-LINAC-001", coverageFingerprint: fpA, calculable: true }
  ]);
  assert.equal(r.outcome, "MULTIPLE_EQUIPMENT_SAME_COVERAGE");
  // Desempate determinístico: menor fieldbeat_equipment_key alfabéticamente.
  assert.equal(r.primaryEquipmentKey, "FB-LINAC-001");
});

test("2 equipos calculables con fingerprints distintos -> MULTIPLE_EQUIPMENT_CONFLICT", () => {
  const fpA = computeCoverageFingerprint([{ startUtc: new Date("2026-08-10T20:00:00Z"), endUtc: new Date("2026-08-10T21:00:00Z") }]);
  const fpB = computeCoverageFingerprint([{ startUtc: new Date("2026-08-10T22:00:00Z"), endUtc: new Date("2026-08-10T23:00:00Z") }]);
  const r = evaluateMultiEquipmentEquivalence([
    { fieldbeatEquipmentKey: "FB-A", coverageFingerprint: fpA, calculable: true },
    { fieldbeatEquipmentKey: "FB-B", coverageFingerprint: fpB, calculable: true }
  ]);
  assert.equal(r.outcome, "MULTIPLE_EQUIPMENT_CONFLICT");
});
