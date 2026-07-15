import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../../src/holidays/hash.js";

test("sha256Hex es determinístico", () => {
  assert.equal(sha256Hex("abc"), sha256Hex("abc"));
});

test("sha256Hex distingue contenidos distintos", () => {
  assert.notEqual(sha256Hex("abc"), sha256Hex("abd"));
});

test("sha256Hex produce 64 caracteres hex", () => {
  const h = sha256Hex("cualquier contenido de bundle");
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});
