import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, sourceRowHash } from "../../src/contracts/hash.js";
import { computeContractFingerprint } from "../../src/contracts/contract-fingerprint.js";

test("sha256Hex: determinista y sensible a cualquier cambio", () => {
  const a = sha256Hex("hola");
  const b = sha256Hex("hola");
  const c = sha256Hex("chau");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("sourceRowHash: cambia si CUALQUIER columna cambia (incluida una firma en Notas)", () => {
  const row1 = ["Cliente", "ABR", "Equipo", "123", "2020", "Vigente", "Gold", "Sí", "No", "Remoto", "24/7", "No", "Sí", "Sí", "Todo Incluído", "2", "Notas -Firma A"];
  const row2 = [...row1];
  row2[16] = "Notas -Firma B";
  assert.notEqual(sourceRowHash(row1), sourceRowHash(row2));
});

const BASE_FIELDS = {
  clientNameCanonical: "Cliente X",
  siteAbbreviation: "AB",
  equipmentModel: "Modelo",
  serialNumber: "123",
  installationMonth: "2020-01-01",
  installationDatePrecision: "YEAR",
  contractStatusCode: "ACTIVE_AUTO_RENEW",
  spaTierCode: "GOLD",
  weekdayService: true,
  weekendService: false,
  supportModeCode: "REMOTE",
  partsCoverageCode: "FULL_COVERAGE",
  hwRefreshCode: "NO",
  updatesCode: "YES",
  upgradesCode: "YES",
  preventiveMaintenanceMin: 2,
  preventiveMaintenanceMax: 2,
  preventiveMaintenanceRule: null,
  warrantyEndDate: null
};

const BASE_WINDOWS = [{ dayOfWeek: "MON", startTime: "08:00", endTime: "17:00", allDay: false, includesHolidays: false }];

test("computeContractFingerprint: estable ante los mismos campos normalizados", () => {
  const f1 = computeContractFingerprint(BASE_FIELDS, BASE_WINDOWS);
  const f2 = computeContractFingerprint({ ...BASE_FIELDS }, [...BASE_WINDOWS]);
  assert.equal(f1, f2);
});

test("computeContractFingerprint: cambia si cambia un campo contractual real (ej. warrantyEndDate)", () => {
  const f1 = computeContractFingerprint(BASE_FIELDS, BASE_WINDOWS);
  const f2 = computeContractFingerprint({ ...BASE_FIELDS, warrantyEndDate: "2025-01-01" }, BASE_WINDOWS);
  assert.notEqual(f1, f2);
});

test("computeContractFingerprint: independiente del orden de las ventanas (canonicalizado por día)", () => {
  const windowsA = [
    { dayOfWeek: "MON", startTime: "08:00", endTime: "17:00", allDay: false, includesHolidays: false },
    { dayOfWeek: "TUE", startTime: "08:00", endTime: "17:00", allDay: false, includesHolidays: false }
  ];
  const windowsB = [...windowsA].reverse();
  assert.equal(
    computeContractFingerprint(BASE_FIELDS, windowsA),
    computeContractFingerprint(BASE_FIELDS, windowsB)
  );
});
