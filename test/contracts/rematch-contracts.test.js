import test from "node:test";
import assert from "node:assert/strict";

import { buildContractRematchPlan } from "../../src/contracts/rematch-contracts.js";

test("rematching posterior al refresh vincula SN:154325 con Linac-154325", () => {
  const plan = buildContractRematchPlan({
    contracts: [{
      observation_id: 13,
      equipment_key: "SN:154325",
      client_name_canonical: "Hospital Carlos Van Buren",
      equipment_model: "VersaHD",
      serial_number: "154325"
    }],
    fieldbeatEquipments: [{
      equipment_key: "FB-LINAC-154325",
      equipment_uuid: "a42edbe1-2603-4ba4-b22f-35b213087dc1",
      internal_id: "Linac-154325",
      client_key: "HCVB"
    }],
    fieldbeatClients: [{ client_key: "HCVB", client_name: "HOSPITAL CARLOS VAN BUREN (SSVSA)" }],
    overrides: [],
    clientAliasIndex: new Map()
  });

  assert.deepEqual(plan.summary, { total: 1, matched: 1, ambiguous: 0, unmatched: 0 });
  assert.equal(plan.rows[0].observationId, 13);
  assert.equal(plan.rows[0].matchStatus, "MATCHED");
  assert.equal(plan.rows[0].matchMethod, "SERIAL_SUFFIX");
  assert.equal(plan.rows[0].fieldbeatInternalId, "Linac-154325");
});

test("rematching conserva UNMATCHED explícito cuando no existe evidencia real", () => {
  const plan = buildContractRematchPlan({
    contracts: [{
      observation_id: 14,
      equipment_key: "SN:999999",
      client_name_canonical: "Cliente sin equipo",
      equipment_model: "VersaHD",
      serial_number: "999999"
    }],
    fieldbeatEquipments: [],
    fieldbeatClients: [],
    overrides: [],
    clientAliasIndex: new Map()
  });

  assert.deepEqual(plan.summary, { total: 1, matched: 0, ambiguous: 0, unmatched: 1 });
  assert.equal(plan.rows[0].matchStatus, "UNMATCHED");
  assert.equal(plan.rows[0].candidateCount, 0);
});
