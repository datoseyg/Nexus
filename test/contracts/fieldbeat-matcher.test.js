import { test } from "node:test";
import assert from "node:assert/strict";
import { matchOneEquipment, matchResultToIssues } from "../../src/contracts/fieldbeat-matcher.js";

const FIELDBEAT_EQUIPMENTS = [
  { equipment_key: "K1", equipment_uuid: "u1", internal_id: "Linac-109166", client_key: "C1" },
  { equipment_key: "K2", equipment_uuid: "u2", internal_id: "Linac-999999", client_key: "C1" },
  { equipment_key: "K3", equipment_uuid: "u3", internal_id: "Linac-500000", client_key: "C2" },
  { equipment_key: "K4", equipment_uuid: "u4", internal_id: "Linac-500000", client_key: "C2" }
];
const FIELDBEAT_CLIENTS = [
  { client_key: "C1", client_name: "Cliente Uno" },
  { client_key: "C2", client_name: "Cliente Dos" }
];

test("match exacto por sufijo de serie -> MATCHED", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:109166", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: "109166" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "SERIAL_SUFFIX");
  assert.equal(r.fieldbeatEquipmentKey, "K1");
  assert.equal(matchResultToIssues(r).length, 0);
});

test("match ambiguo por sufijo de serie duplicado -> AMBIGUOUS, nunca autoconfirmado", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:500000", clientNameCanonical: "Cliente Dos", equipmentModel: "VersaHD", serialNumber: "500000" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.candidateCount, 2);
  assert.equal(r.fieldbeatEquipmentKey, null);
  assert.equal(matchResultToIssues(r)[0].issueType, "AMBIGUOUS_FIELDBEAT_MATCH");
});

test("sin serial y sin candidato de cliente+modelo -> UNMATCHED", () => {
  const r = matchOneEquipment(
    { equipmentKey: "PROV:abc", clientNameCanonical: "Cliente Inexistente", equipmentModel: "Flexitron", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "UNMATCHED");
  assert.equal(r.matchMethod, "NONE");
  assert.equal(matchResultToIssues(r)[0].issueType, "UNMATCHED_FIELDBEAT_EQUIPMENT");
});

test("override activo -> MATCHED vía OVERRIDE, tiene prioridad sobre el resto", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:109166", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: "109166" },
    {
      fieldbeatEquipments: FIELDBEAT_EQUIPMENTS,
      fieldbeatClients: FIELDBEAT_CLIENTS,
      overrides: [{ equipmentKey: "SN:109166", fieldbeatEquipmentId: "K2" }]
    }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "OVERRIDE");
  assert.equal(r.fieldbeatEquipmentKey, "K2");
});

test("cliente+categoría de equipo con un solo candidato -> MATCHED vía CLIENT_SITE_MODEL", () => {
  const r = matchOneEquipment(
    { equipmentKey: "PROV:xyz", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  // Cliente Uno tiene 2 equipos LINAC (K1, K2) -> ambiguo, no 1 solo.
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.matchMethod, "CLIENT_SITE_MODEL");
});
