import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContractStartDate, loadKnownContractStartDates } from "../../src/contracts/contract-start-date-resolver.js";

function knownDates(entries) {
  return new Map(entries.map(e => [e.equipment_key, e]));
}

// === Orden de resolución (ETAPA 6.5.1 regla 1-4) ===

test("fecha de negocio conocida tiene prioridad sobre installation_month, aunque contradiga la instalación", () => {
  const known = knownDates([{ equipment_key: "SN:153038", valid_from: "2021-07-24", valid_from_precision: "DAY", source_field: "known_business_date", source_value_raw: "2021-07-24" }]);
  const r = resolveContractStartDate({ equipmentKey: "SN:153038", installationMonth: "2015-08-01", installationDatePrecision: "MONTH" }, known);
  assert.equal(r.validFrom, "2021-07-24");
  assert.equal(r.validFromIsInferred, false);
  assert.equal(r.validFromBasis, "EXPLICIT_KNOWN_DATE");
  assert.equal(r.validFromPrecision, "DAY");
});

test("sin fecha conocida, con installation_month real -> inferido, is_inferred=true", () => {
  const r = resolveContractStartDate({ equipmentKey: "SN:156473", installationMonth: "2021-02-01", installationDatePrecision: "MONTH" }, knownDates([]));
  assert.equal(r.validFrom, "2021-02-01");
  assert.equal(r.validFromIsInferred, true);
  assert.equal(r.validFromBasis, "INSTALLATION_DATE_INFERRED");
  assert.equal(r.validFromPrecision, "MONTH");
  assert.equal(r.validFromSourceField, "installation_month");
});

test("installation_date_precision=YEAR se propaga tal cual, nunca se inventa día/mes", () => {
  const r = resolveContractStartDate({ equipmentKey: "SN:154325", installationMonth: "2017-01-01", installationDatePrecision: "YEAR" }, knownDates([]));
  assert.equal(r.validFromPrecision, "YEAR");
  assert.equal(r.validFromBasis, "INSTALLATION_DATE_INFERRED");
});

test("sin fecha conocida y sin installation_month (UNKNOWN) -> UNRESOLVED, valid_from NULL, nunca fabricado", () => {
  const r = resolveContractStartDate({ equipmentKey: "SN:201110", installationMonth: null, installationDatePrecision: "UNKNOWN" }, knownDates([]));
  assert.equal(r.validFrom, null);
  assert.equal(r.validFromBasis, "UNRESOLVED");
  assert.equal(r.validFromPrecision, "UNKNOWN");
  assert.equal(r.validFromSourceField, null);
});

test("installation_date_precision=UNKNOWN con installationMonth null (aunque installationDatePrecision no fuera UNKNOWN) -> UNRESOLVED, nunca confía en un solo campo", () => {
  const r = resolveContractStartDate({ equipmentKey: "SN:X", installationMonth: null, installationDatePrecision: "MONTH" }, knownDates([]));
  assert.equal(r.validFrom, null);
  assert.equal(r.validFromBasis, "UNRESOLVED");
});

test("equipment_key ausente del mapa de fechas conocidas cae a installation_month, nunca revienta", () => {
  const known = knownDates([{ equipment_key: "SN:OTRO", valid_from: "2020-01-01", valid_from_precision: "DAY", source_field: "known_business_date", source_value_raw: "2020-01-01" }]);
  const r = resolveContractStartDate({ equipmentKey: "SN:156473", installationMonth: "2021-02-01", installationDatePrecision: "MONTH" }, known);
  assert.equal(r.validFromBasis, "INSTALLATION_DATE_INFERRED");
});

// === Caso real MicroSelectron (contrato cerrado, no vigente - excluido a propósito del JSON de fechas conocidas) ===

test("equipo con contrato cerrado (excluido del JSON, sin installation_month) -> UNRESOLVED, nunca asigna una fecha fantasma", () => {
  const r = resolveContractStartDate({ equipmentKey: "SN:10806", installationMonth: null, installationDatePrecision: "UNKNOWN" }, knownDates([]));
  assert.equal(r.validFrom, null);
  assert.equal(r.validFromBasis, "UNRESOLVED");
});

// === Carga real del archivo gobernado ===

test("loadKnownContractStartDates: carga el archivo real y expone las 8 fechas explícitas esperadas", () => {
  const map = loadKnownContractStartDates("data/config/contracts/known-contract-start-dates.json");
  assert.equal(map.size, 8);
  assert.equal(map.get("SN:153038").valid_from, "2021-07-24");
  assert.equal(map.get("SN:154325").valid_from_precision, "YEAR");
  // MicroSelectron y Compact están en "excluded", no en "entries" -nunca deben aparecer acá.
  assert.equal(map.has("SN:10806"), false);
  assert.equal(map.has("SN:201110"), false);
});
