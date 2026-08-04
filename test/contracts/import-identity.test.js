import { test } from "node:test";
import assert from "node:assert/strict";
import { findSuccessfulContractImport } from "../../src/contracts/import-identity.js";

function catalog(successfulIdentities) {
  return {
    async query(_sql, [sha, version]) {
      return { rows: successfulIdentities.has(`${sha}:${version}`) ? [{ import_id: 7 }] : [] };
    }
  };
}

test("mismo CSV + misma version es duplicado", async () => {
  const prior = await findSuccessfulContractImport(catalog(new Set(["sha:v2"])), { sourceSha256: "sha", transformVersion: "v2" });
  assert.equal(prior.import_id, 7);
});

test("mismo CSV + version distinta permite importar", async () => {
  const prior = await findSuccessfulContractImport(catalog(new Set(["sha:v1"])), { sourceSha256: "sha", transformVersion: "v2" });
  assert.equal(prior, null);
});

test("segunda ejecucion de la nueva version es duplicado", async () => {
  const successful = new Set(["sha:v1"]);
  assert.equal(await findSuccessfulContractImport(catalog(successful), { sourceSha256: "sha", transformVersion: "v2" }), null);
  successful.add("sha:v2");
  const second = await findSuccessfulContractImport(catalog(successful), { sourceSha256: "sha", transformVersion: "v2" });
  assert.equal(second.import_id, 7);
});
