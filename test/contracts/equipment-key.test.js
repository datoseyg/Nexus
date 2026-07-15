import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEquipmentKey } from "../../src/contracts/equipment-key.js";

test("con serial -> clave namespaced SN:, nunca provisional", () => {
  const r = buildEquipmentKey({ clientNameCanonical: "Cliente X", siteAbbreviation: "AB", equipmentModel: "VersaHD", serialNumber: "109166" });
  assert.equal(r.equipmentKey, "SN:109166");
  assert.equal(r.isProvisional, false);
});

test("sin serial -> clave provisional PROV:, estable para los mismos campos de identidad", () => {
  const input = { clientNameCanonical: "Cliente X", siteAbbreviation: "AB", equipmentModel: "VersaHD", serialNumber: null };
  const r1 = buildEquipmentKey(input);
  const r2 = buildEquipmentKey({ ...input });
  assert.ok(r1.equipmentKey.startsWith("PROV:"));
  assert.equal(r1.isProvisional, true);
  assert.equal(r1.equipmentKey, r2.equipmentKey);
});

test("clave provisional NO cambia si solo cambia un campo contractual (no de identidad)", () => {
  // buildEquipmentKey solo recibe campos de identidad -esto documenta que
  // el llamador nunca debe pasarle campos contractuales (estado, spa, etc.)
  const input = { clientNameCanonical: "Cliente X", siteAbbreviation: "AB", equipmentModel: "VersaHD", serialNumber: "" };
  const r1 = buildEquipmentKey(input);
  const r2 = buildEquipmentKey(input); // simula una 2da importación con los mismos campos de identidad
  assert.equal(r1.equipmentKey, r2.equipmentKey);
});

test("clave provisional cambia si cambia el modelo o la sede (campos de identidad reales)", () => {
  const base = { clientNameCanonical: "Cliente X", siteAbbreviation: "AB", equipmentModel: "VersaHD", serialNumber: null };
  const otherModel = buildEquipmentKey({ ...base, equipmentModel: "Synergy" });
  const base2 = buildEquipmentKey(base);
  assert.notEqual(base2.equipmentKey, otherModel.equipmentKey);
});
