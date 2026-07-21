import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("runner de integración aborta si faltan URL o RUN_ID", () => {
  const env = { ...process.env };
  delete env.AFTER_HOURS_TEST_DATABASE_URL;
  delete env.AFTER_HOURS_TEST_RUN_ID;

  const result = spawnSync(process.execPath, ["scripts/run-integration-tests.mjs"], {
    encoding: "utf8",
    env
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /AFTER_HOURS_TEST_DATABASE_URL.*AFTER_HOURS_TEST_RUN_ID/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /=== test\/after-hours\/.*integration\.test\.ts ===/);
});
