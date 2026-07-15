import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateArgs } from "../../src/holidays/cli.js";

test("sin subcomando -> inválido", () => {
  const r = validateArgs(parseArgs([]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Subcomando requerido/);
});

test("subcomando desconocido -> subcommand null -> inválido", () => {
  const args = parseArgs(["borrar-todo", "--file=x.json"]);
  assert.equal(args.subcommand, null);
  assert.equal(validateArgs(args).ok, false);
});

test("validate sin --file -> inválido", () => {
  const r = validateArgs(parseArgs(["validate"]));
  assert.equal(r.ok, false);
});

test("validate con --file -> válido", () => {
  const r = validateArgs(parseArgs(["validate", "--file=data/config/holidays/CL/2026.json"]));
  assert.equal(r.ok, true);
});

test("dry-run con --file -> válido, no requiere --confirm", () => {
  const r = validateArgs(parseArgs(["dry-run", "--file=data/config/holidays/CL/2026.json"]));
  assert.equal(r.ok, true);
});

test("apply sin --confirm -> inválido (nunca apply implícito)", () => {
  const r = validateArgs(parseArgs(["apply", "--file=data/config/holidays/CL/2026.json"]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /--confirm/);
});

test("apply con --confirm -> válido", () => {
  const r = validateArgs(parseArgs(["apply", "--file=data/config/holidays/CL/2026.json", "--confirm"]));
  assert.equal(r.ok, true);
});

test("publish sin --coverage-id -> inválido", () => {
  const r = validateArgs(parseArgs(["publish"]));
  assert.equal(r.ok, false);
});

test("publish con --coverage-id -> válido", () => {
  const r = validateArgs(parseArgs(["publish", "--coverage-id=42"]));
  assert.equal(r.ok, true);
});

test("publish con --supersede-coverage-id igual a --coverage-id -> inválido", () => {
  const r = validateArgs(parseArgs(["publish", "--coverage-id=42", "--supersede-coverage-id=42"]));
  assert.equal(r.ok, false);
});

test("publish con --supersede-coverage-id distinto -> válido", () => {
  const r = validateArgs(parseArgs(["publish", "--coverage-id=43", "--supersede-coverage-id=42"]));
  assert.equal(r.ok, true);
});
