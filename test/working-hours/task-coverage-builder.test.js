import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskCoverage } from "../../src/working-hours/task-coverage-builder.js";

const businessHoursCfg = { status: "DEFAULT_UNVALIDATED", timezone: "America/Santiago", weekly_schedule: {
  monday: { is_business_day: true, start: "08:30", end: "18:30" }, tuesday: { is_business_day: true, start: "08:30", end: "18:30" },
  wednesday: { is_business_day: true, start: "08:30", end: "18:30" }, thursday: { is_business_day: true, start: "08:30", end: "18:30" },
  friday: { is_business_day: true, start: "08:30", end: "18:30" }, saturday: { is_business_day: false }, sunday: { is_business_day: false }
} };
const confidenceContext = { businessHoursStatus: "DEFAULT_UNVALIDATED", holidaysStatus: "VALIDATED" };
function noHoliday() { return "CONFIRMED_NOT_HOLIDAY"; }

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const FIXED_WINDOW_ALL_WEEK = DAYS.map(dayOfWeek => ({ dayOfWeek, startTime: "00:00", endTime: "23:59", allDay: false }));
const ALL_DAY_ALL_WEEK = DAYS.map(dayOfWeek => ({ dayOfWeek, allDay: true })); // FULL_24X7 real: config.contract_service_windows trae filas all_day=true para los 7 días, la cobertura NO es un "always covered" implícito por coverage_type

function contractualEquipment(key, { versionId = 1, statusCode = "ACTIVE_AUTO_RENEW", coverageType = "FULL_24X7", matchMethod = "SERIAL_SUFFIX" } = {}) {
  return {
    fieldbeatEquipmentKey: key,
    match: { matchStatus: "MATCHED", matchMethod, contractEquipmentKey: `SN:${key}` },
    versions: [{ contractVersionId: versionId, validFrom: "2020-01-01", validTo: null, contractStatusCode: statusCode }],
    scheduleByVersionId: new Map([[versionId, { scheduleId: versionId, coverageType, parseStatus: "OK" }]]),
    windowsByScheduleId: new Map([[versionId, coverageType === "FULL_24X7" ? ALL_DAY_ALL_WEEK : FIXED_WINDOW_ALL_WEEK]])
  };
}

function run(overrides) {
  return buildTaskCoverage({
    task: { startTimeRaw: "2026-08-10T20:00:00Z", durationMinutes: 60, clientKey: "C1", taskType: "PM", assignedTo: "tech1" },
    confidenceContext, equipmentInputs: [], holidayLookup: noHoliday, businessHoursCfg,
    ...overrides
  });
}

test("intervalo no resoluble (INVALID_START_TIME) -> NONE inmediato, sin segmentos, sin intentar cascada", () => {
  const r = run({ task: { startTimeRaw: null, durationMinutes: 60 } });
  assert.equal(r.dataBasis, "NONE");
  assert.equal(r.fallbackUsed, false);
  assert.equal(r.segments.length, 0);
  assert.equal(r.contractualAttemptStatus, "NOT_CALCULABLE");
});

test("sin equipos -> NO_EQUIPMENT, cae a LEGACY_SCHEDULE preservando contractualReasonCode=NO_EQUIPMENT", () => {
  const r = run({ equipmentInputs: [] });
  assert.equal(r.dataBasis, "LEGACY_SCHEDULE");
  assert.equal(r.fallbackUsed, true);
  assert.equal(r.contractualAttemptStatus, "NOT_CALCULABLE");
  assert.equal(r.contractualReasonCode, "NO_EQUIPMENT");
  assert.equal(r.coverageReasonCode, "WITHIN_LEGACY_SCHEDULE");
});

test("caso 3824: Working-Hours analiza el intervalo informado multidiario y conserva su procedencia", () => {
  const r = run({
    task: {
      startTimeRaw: "2026-07-31T23:01:00.000Z",
      durationMinutes: 120,
      reportedStartRaw: "30/07/2026 06:02",
      reportedEndRaw: "31/07/2026 23:13",
      deliveredRaw: "31/07/2026 23:15",
      clientKey: "C1",
      taskType: "CORRECTIVA PROGRAMADA",
      assignedTo: "mabreu"
    },
    equipmentInputs: []
  });
  assert.equal(r.analysisIntervalBasis, "REPORTED_WORK_INTERVAL");
  assert.equal(r.analysisFallbackUsed, false);
  assert.equal(r.analysisFallbackReason, null);
  assert.equal(r.startTimeUtc.toISOString(), "2026-07-30T10:02:00.000Z");
  assert.equal(r.endTimeUtc.toISOString(), "2026-08-01T03:13:00.000Z");
  assert.equal(r.durationSeconds, 2471 * 60);
  assert.equal(r.deliveredAt.toISOString(), "2026-08-01T03:15:00.000Z");
});

test("1 equipo con contrato FULL_24X7 vigente -> CONTRACTUAL, WITHIN_MATCHED_CONTRACT, sin fallback", () => {
  const r = run({ equipmentInputs: [contractualEquipment("EQ-1")] });
  assert.equal(r.dataBasis, "CONTRACTUAL");
  assert.equal(r.fallbackUsed, false);
  assert.equal(r.coverageReasonCode, "WITHIN_MATCHED_CONTRACT");
  assert.equal(r.coverageClassification, "FULLY_COVERED");
  assert.equal(r.contractResolutionConfidence, 90); // SERIAL_SUFFIX(+40) + FULL_24X7(+30) + SINGLE(+20)
  assert.equal(r.equipmentLinks.length, 1);
  assert.equal(r.equipmentLinks[0].isPrimary, true);
});

test("la aplicabilidad contractual usa la fecha local de Santiago en el límite de sourceEffectiveDate", () => {
  const equipment = contractualEquipment("EQ-1");
  equipment.versions[0] = {
    contractVersionId: 1,
    validFrom: null,
    validTo: null,
    sourceEffectiveDate: "2026-01-01",
    contractStatusCode: "ACTIVE_AUTO_RENEW"
  };
  const beforeLocalMidnight = run({
    task: { startTimeRaw: "2026-01-01T02:30:00Z", durationMinutes: 30, clientKey: "C1", taskType: "PM", assignedTo: "tech1" },
    equipmentInputs: [equipment]
  });
  const afterLocalMidnight = run({
    task: { startTimeRaw: "2026-01-01T03:30:00Z", durationMinutes: 30, clientKey: "C1", taskType: "PM", assignedTo: "tech1" },
    equipmentInputs: [equipment]
  });
  assert.equal(beforeLocalMidnight.dataBasis, "LEGACY_SCHEDULE");
  assert.equal(beforeLocalMidnight.contractualReasonCode, "NO_CONTRACT_AT_TASK_DATE");
  assert.equal(afterLocalMidnight.dataBasis, "CONTRACTUAL");
  assert.equal(afterLocalMidnight.fallbackUsed, false);
});

test("1 equipo EQUIPMENT_UNMATCHED -> cae a LEGACY_SCHEDULE, preserva contractualReasonCode", () => {
  const r = run({ equipmentInputs: [{ fieldbeatEquipmentKey: "EQ-1", match: { matchStatus: "UNMATCHED" }, versions: [], scheduleByVersionId: new Map(), windowsByScheduleId: new Map() }] });
  assert.equal(r.dataBasis, "LEGACY_SCHEDULE");
  assert.equal(r.fallbackUsed, true);
  assert.equal(r.contractualReasonCode, "EQUIPMENT_UNMATCHED");
  assert.equal(r.contractResolutionConfidence, null, "confianza contractual nunca se calcula fuera de CONTRACTUAL");
});

test("2 equipos con fingerprint IDÉNTICO -> MULTIPLE_EQUIPMENT_SAME_COVERAGE, CONTRACTUAL, exactamente 1 primario", () => {
  const r = run({ equipmentInputs: [contractualEquipment("EQ-1"), contractualEquipment("EQ-2")] });
  assert.equal(r.dataBasis, "CONTRACTUAL");
  assert.equal(r.coverageReasonCode, "MULTIPLE_EQUIPMENT_SAME_COVERAGE");
  assert.equal(r.equipmentLinks.filter(l => l.isPrimary).length, 1);
});

test("2 equipos con fingerprint DISTINTO (coberturas distintas) -> MULTIPLE_EQUIPMENT_CONFLICT, cae a LEGACY_SCHEDULE, nunca promedia/prioriza uno", () => {
  const eq1 = contractualEquipment("EQ-1", { versionId: 1, coverageType: "FULL_24X7" }); // cubre 16:00-17:00 local completo
  const eq2 = { ...contractualEquipment("EQ-2", { versionId: 2, coverageType: "FIXED_WINDOW" }),
    windowsByScheduleId: new Map([[2, [{ dayOfWeek: "MON", startTime: "08:00", endTime: "09:00", allDay: false }]]]) }; // ventana angosta que NO cubre la tarea -> intervalo cubierto vacío, fingerprint distinto
  const r = run({ equipmentInputs: [eq1, eq2] });
  assert.equal(r.contractualReasonCode, "MULTIPLE_EQUIPMENT_CONFLICT");
  assert.equal(r.dataBasis, "LEGACY_SCHEDULE", "conflicto intenta el fallback LEGACY_SCHEDULE, nunca inventa un ganador");
  assert.equal(r.equipmentLinks.filter(l => l.isPrimary).length, 0, "ningún equipo queda marcado primario en conflicto");
});

test("equipo con estado DEINSTALLED -> no calculable, cae a LEGACY_SCHEDULE preservando el reason code específico", () => {
  const r = run({ equipmentInputs: [contractualEquipment("EQ-1", { statusCode: "DEINSTALLED" })] });
  assert.equal(r.dataBasis, "LEGACY_SCHEDULE");
  assert.equal(r.contractualReasonCode, "CONTRACT_STATUS_DEINSTALLED");
});

test("NO_CONTRACT + N/A usa horario global con motivo NO_CONTRACT explícito", () => {
  const equipment = contractualEquipment("EQ-105614", { statusCode: "NO_CONTRACT" });
  equipment.scheduleByVersionId = new Map([[1, { scheduleId: 1, coverageType: "NOT_APPLICABLE", parseStatus: "REVIEW_REQUIRED" }]]);
  equipment.windowsByScheduleId = new Map([[1, []]]);
  const r = run({ equipmentInputs: [equipment] });
  assert.equal(r.dataBasis, "LEGACY_SCHEDULE");
  assert.equal(r.fallbackUsed, true);
  assert.equal(r.contractualReasonCode, "NO_CONTRACT");
  assert.equal(r.coverageReasonCode, "WITHIN_LEGACY_SCHEDULE");
  assert.equal(r.equipmentLinks[0].contractVersionId, 1);
  assert.equal(r.equipmentLinks[0].scheduleId, null);
});

test("equipo CRITICAL_ONLY_24X7 sin señal de criticidad -> CRITICALITY_UNKNOWN, nunca se asume crítico ni no-crítico", () => {
  const r = run({ equipmentInputs: [contractualEquipment("EQ-1", { coverageType: "CRITICAL_ONLY_24X7" })] });
  assert.equal(r.contractualReasonCode, "CRITICALITY_UNKNOWN");
  assert.equal(r.dataBasis, "LEGACY_SCHEDULE");
});

test("ambos (contractual y legacy) fallan -> NONE, intervalo se conserva (no NULL), minutos sí quedan NULL", () => {
  // holidayLookup siempre COVERAGE_UNKNOWN -> ni el intento contractual ni el legado pueden calcular.
  const r = run({ equipmentInputs: [], holidayLookup: () => "COVERAGE_UNKNOWN" });
  assert.equal(r.dataBasis, "NONE");
  assert.notEqual(r.startTimeUtc, null, "el intervalo temporal SÍ se resolvió, la cascada falló en cobertura, no en el intervalo");
  assert.equal(r.coveredSeconds, null);
  assert.equal(r.afterHoursTotalSeconds, null);
});

test("confidence_score (legado, 6 factores) es idéntico entre CONTRACTUAL y LEGACY_SCHEDULE para la misma tarea -contract_resolution_confidence nunca lo altera", () => {
  const withContract = run({ equipmentInputs: [contractualEquipment("EQ-1")] });
  const withoutEquipment = run({ equipmentInputs: [] });
  assert.equal(withContract.confidenceScore, withoutEquipment.confidenceScore, "el score de 6 factores depende solo del intervalo/tarea, nunca de si hubo contrato");
});

test("segmentos: todo segmento CONTRACT trae schedule_source=CONTRACT y equipo asociado; todo segmento LEGACY_GLOBAL trae equipo null", () => {
  const contractual = run({ equipmentInputs: [contractualEquipment("EQ-1")] });
  assert.ok(contractual.segments.every(s => s.scheduleSource === "CONTRACT" && s.fieldbeatEquipmentKey));

  const legacy = run({ equipmentInputs: [] });
  assert.ok(legacy.segments.every(s => s.scheduleSource === "LEGACY_GLOBAL" && s.fieldbeatEquipmentKey === null));
});
