import { test } from "node:test";
import assert from "node:assert/strict";

import { assertIntegrationEnvironment, selectTestFiles } from "../../scripts/run-test-suite.mjs";

const files = [
  "test/contracts/cli.test.js",
  "test/contracts/db-writer.integration.test.js",
  "test/contracts/versioning.test.js",
  "test/contracts/versioning-lifecycle.integration.test.js",
];

test("unit excluye todos los archivos de integración", () => {
  assert.deepEqual(selectTestFiles(files, "unit"), [
    "test/contracts/cli.test.js",
    "test/contracts/versioning.test.js",
  ]);
});

test("integration selecciona solo archivos de integración", () => {
  assert.deepEqual(selectTestFiles(files, "integration"), [
    "test/contracts/db-writer.integration.test.js",
    "test/contracts/versioning-lifecycle.integration.test.js",
  ]);
});

test("integration aborta antes de ejecutar si faltan URL o RUN_ID", () => {
  assert.throws(
    () => assertIntegrationEnvironment("test/contracts", {}),
    /CONTRACTS_TEST_DATABASE_URL.*CONTRACTS_TEST_RUN_ID/
  );
  assert.throws(
    () => assertIntegrationEnvironment("test/holidays", { HOLIDAYS_TEST_DATABASE_URL: "postgresql://local/db" }),
    /HOLIDAYS_TEST_RUN_ID/
  );
});

test("integration acepta ambos marcadores requeridos por la suite", () => {
  assert.doesNotThrow(() => assertIntegrationEnvironment("test/working-hours", {
    WORKING_HOURS_TEST_DATABASE_URL: "postgresql://local/db",
    WORKING_HOURS_TEST_RUN_ID: "run-local"
  }));
});
