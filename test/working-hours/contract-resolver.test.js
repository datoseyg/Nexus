import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEquipmentContract } from "../../src/working-hours/contract-resolver.js";

const scheduleByVersionId = new Map([
  [1, { scheduleId: 10, coverageType: "FIXED_WINDOW", parseStatus: "OK" }],
  [2, { scheduleId: 20, coverageType: "CRITICAL_ONLY_24X7", parseStatus: "OK" }],
  [3, { scheduleId: 30, coverageType: "FULL_24X7", parseStatus: "REVIEW_REQUIRED" }]
]);
const windowsByScheduleId = new Map([[10, [{ dayOfWeek: "MON", startTime: "08:00", endTime: "17:00", allDay: false }]]]);

function base(overrides = {}) {
  return { fieldbeatEquipmentKey: "EQ-1", taskLocalDate: "2026-08-10", match: null, versions: [], scheduleByVersionId, windowsByScheduleId, ...overrides };
}

test("paso 1 -match: UNMATCHED -> EQUIPMENT_UNMATCHED, no calculable", () => {
  const r = resolveEquipmentContract(base({ match: { matchStatus: "UNMATCHED" } }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "EQUIPMENT_UNMATCHED");
});

test("paso 1 -match: sin match en absoluto (null) -> EQUIPMENT_UNMATCHED", () => {
  const r = resolveEquipmentContract(base({ match: null }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "EQUIPMENT_UNMATCHED");
});

test("paso 1 -match: AMBIGUOUS -> EQUIPMENT_AMBIGUOUS, no calculable", () => {
  const r = resolveEquipmentContract(base({ match: { matchStatus: "AMBIGUOUS" } }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "EQUIPMENT_AMBIGUOUS");
});

test("paso 2 -versión: sin versión vigente en la fecha local de la tarea -> NO_CONTRACT_AT_TASK_DATE", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", matchMethod: "SERIAL_SUFFIX", contractEquipmentKey: "SN:1" },
    versions: [{ contractVersionId: 1, validFrom: "2027-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "NO_CONTRACT_AT_TASK_DATE");
  assert.equal(r.matchMethod, "SERIAL_SUFFIX", "matchMethod se propaga incluso cuando falla en un paso posterior");
});

test("paso 2 -versión: valid_to excluye la fecha (rango [from,to) exclusivo)", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:1" },
    versions: [{ contractVersionId: 1, validFrom: "2020-01-01", validTo: "2026-08-10", contractStatusCode: "ACTIVE_AUTO_RENEW" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "NO_CONTRACT_AT_TASK_DATE");
});

test("paso 3 -estado: NO_CONTRACT -> NO_CONTRACT_STATUS", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:1" },
    versions: [{ contractVersionId: 1, validFrom: "2020-01-01", validTo: null, contractStatusCode: "NO_CONTRACT" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "NO_CONTRACT_STATUS");
});

test("paso 3 -estado: ON_DEMAND -> ON_DEMAND_UNDEFINED", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:1" },
    versions: [{ contractVersionId: 1, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ON_DEMAND" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "ON_DEMAND_UNDEFINED");
});

test("paso 3 -estado: DEINSTALLED -> CONTRACT_STATUS_DEINSTALLED", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:1" },
    versions: [{ contractVersionId: 1, validFrom: "2020-01-01", validTo: null, contractStatusCode: "DEINSTALLED" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "CONTRACT_STATUS_DEINSTALLED");
});

test("paso 4 -schedule: parse_status=REVIEW_REQUIRED -> SCHEDULE_REVIEW_REQUIRED", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:3" },
    versions: [{ contractVersionId: 3, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "SCHEDULE_REVIEW_REQUIRED");
});

test("paso 4 -schedule: sin schedule para la versión -> SCHEDULE_REVIEW_REQUIRED", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:99" },
    versions: [{ contractVersionId: 99, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "SCHEDULE_REVIEW_REQUIRED");
});

test("paso 5 -criticidad: CRITICAL_ONLY_24X7 sin señal disponible -> CRITICALITY_UNKNOWN (nunca se inventa una señal)", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:2" },
    versions: [{ contractVersionId: 2, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }]
  }));
  assert.equal(r.calculable, false);
  assert.equal(r.reasonCode, "CRITICALITY_UNKNOWN");
});

test("caso feliz: match+versión+estado+schedule OK -> calculable, WITHIN_MATCHED_CONTRACT, windows presentes", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", matchMethod: "SERIAL_SUFFIX", contractEquipmentKey: "SN:1" },
    versions: [{ contractVersionId: 1, validFrom: "2020-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }]
  }));
  assert.equal(r.calculable, true);
  assert.equal(r.reasonCode, "WITHIN_MATCHED_CONTRACT");
  assert.equal(r.coverageType, "FIXED_WINDOW");
  assert.equal(r.windows.length, 1);
});

test("múltiples versiones: elige la vigente en la fecha local de la tarea, no la más reciente ni la primera", () => {
  const r = resolveEquipmentContract(base({
    match: { matchStatus: "MATCHED", contractEquipmentKey: "SN:1" },
    versions: [
      { contractVersionId: 2, validFrom: "2018-01-01", validTo: "2022-01-01", contractStatusCode: "DEINSTALLED" },
      { contractVersionId: 1, validFrom: "2022-01-01", validTo: null, contractStatusCode: "ACTIVE_AUTO_RENEW" }
    ]
  }));
  assert.equal(r.calculable, true);
  assert.equal(r.contractVersionId, 1);
});
