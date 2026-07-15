import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePreventiveMaintenance } from "../../src/contracts/normalize-preventive-maintenance.js";

test("'6' -> min=6 max=6", () => {
  assert.deepEqual(parsePreventiveMaintenance("6"), { min: 6, max: 6, rule: null, issues: [] });
});

test("'3-4' -> min=3 max=4", () => {
  assert.deepEqual(parsePreventiveMaintenance("3-4"), { min: 3, max: 4, rule: null, issues: [] });
});

test("'-' -> null/null sin issue (marcador explícito de no-aplica)", () => {
  assert.deepEqual(parsePreventiveMaintenance("-"), { min: null, max: null, rule: null, issues: [] });
});

test("'Por cada cambio fuente' -> regla textual, sin número inventado, issue NON_SCALAR_PREVENTIVE_QUOTA", () => {
  const r = parsePreventiveMaintenance("Por cada cambio fuente");
  assert.equal(r.min, null);
  assert.equal(r.max, null);
  assert.equal(r.rule, "Por cada cambio fuente");
  assert.equal(r.issues[0].issueType, "NON_SCALAR_PREVENTIVE_QUOTA");
});
