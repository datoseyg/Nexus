import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDryRunDatabaseState } from "../../src/contracts/dry-run-db-state.js";

test("dry-run conectado resuelve duplicado y versionAction sin escribir ni consultar por fila", async () => {
  const queries = [];
  const queryable = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("contract_import_runs")) {
        return { rows: [{ import_id: 41 }] };
      }
      if (sql.includes("contract_equipment_versions")) {
        return {
          rows: [{
            contract_version_id: 9,
            equipment_key: "SN:154325",
            contract_fingerprint: "same-fingerprint",
            valid_from: "2017-01-01"
          }]
        };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }
  };

  const records = [
    {
      equipmentKey: "SN:154325",
      contractFingerprint: "same-fingerprint",
      normalizedFields: { installationMonth: "2017-01-01", installationDatePrecision: "YEAR" }
    },
    {
      equipmentKey: "SN:NEW",
      contractFingerprint: "new-fingerprint",
      normalizedFields: { installationMonth: null, installationDatePrecision: "UNKNOWN" }
    }
  ];

  const state = await loadDryRunDatabaseState(queryable, {
    sourceSha256: "source-sha",
    records,
    effectiveDate: "2026-01-01",
    knownContractStartDates: new Map()
  });

  assert.deepEqual(state.alreadyImported, {
    isDuplicate: true,
    priorImportId: 41,
    transformVersion: "contracts-v2-business-hours-0830"
  });
  assert.equal(state.versionActions.get("SN:154325"), "UNCHANGED");
  assert.equal(state.versionActions.get("SN:NEW"), "NEW");
  assert.equal(queries.length, 2, "el peek usa dos consultas batch fijas, nunca N+1");
  assert.deepEqual(queries[0].params, ["source-sha", "contracts-v2-business-hours-0830"]);
  assert.deepEqual(queries[1].params, [["SN:154325", "SN:NEW"]]);
});
