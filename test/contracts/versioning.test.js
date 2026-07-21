import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVersionAction } from "../../src/contracts/versioning.js";

test("sin versión previa -> NEW", () => {
  const r = computeVersionAction("fingerprint-a", null, "2026-01-01");
  assert.equal(r.action, "NEW");
});

test("mismo fingerprint -> UNCHANGED (nunca compara source_row_hash)", () => {
  const current = { contract_version_id: 1, contract_fingerprint: "fp-same", valid_from: "2025-01-01" };
  const r = computeVersionAction("fp-same", current, "2026-01-01");
  assert.equal(r.action, "UNCHANGED");
});

test("fingerprint distinto y effective_date posterior -> SUPERSEDE", () => {
  const current = { contract_version_id: 1, contract_fingerprint: "fp-old", valid_from: "2025-01-01" };
  const r = computeVersionAction("fp-new", current, "2026-01-01");
  assert.equal(r.action, "SUPERSEDE");
});

test("effective_date <= valid_from vigente -> FATAL_BACKDATED, incluso con fingerprint distinto", () => {
  const current = { contract_version_id: 1, contract_fingerprint: "fp-old", valid_from: "2026-01-01" };
  const equal = computeVersionAction("fp-new", current, "2026-01-01");
  const before = computeVersionAction("fp-new", current, "2025-06-01");
  assert.equal(equal.action, "FATAL_BACKDATED");
  assert.equal(before.action, "FATAL_BACKDATED");
  assert.ok(equal.reason);
});

test("valid_from vigente NULL (ETAPA 6.5.1, UNRESOLVED) nunca dispara FATAL_BACKDATED -guard explícito, no coerción implícita", () => {
  const current = { contract_version_id: 1, contract_fingerprint: "fp-old", valid_from: null };
  const r = computeVersionAction("fp-new", current, "2026-01-01");
  assert.notEqual(r.action, "FATAL_BACKDATED");
  assert.equal(r.action, "SUPERSEDE");
});
