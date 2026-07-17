import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateArgs } from "../../src/working-hours/cli.js";

test("sin subcomando -> subcommand null", () => {
  const args = parseArgs([]);
  assert.equal(args.subcommand, null);
});

test("validateArgs: sin subcomando -> inválido", () => {
  const r = validateArgs(parseArgs([]));
  assert.equal(r.ok, false);
});

test("dry-run -> subcommand reconocido, válido sin --confirm", () => {
  const args = parseArgs(["dry-run"]);
  assert.equal(args.subcommand, "dry-run");
  assert.equal(validateArgs(args).ok, true);
});

test("apply sin --confirm -> inválido (nunca apply implícito)", () => {
  const args = parseArgs(["apply"]);
  assert.equal(args.subcommand, "apply");
  assert.equal(args.confirm, false);
  assert.equal(validateArgs(args).ok, false);
});

test("apply --confirm -> válido", () => {
  const args = parseArgs(["apply", "--confirm"]);
  assert.equal(args.confirm, true);
  assert.equal(validateArgs(args).ok, true);
});

test("apply --confirm --from=2026-01-01 --to=2026-12-31 -> válido, rango parseado", () => {
  const args = parseArgs(["apply", "--confirm", "--from=2026-01-01", "--to=2026-12-31"]);
  assert.equal(args.from, "2026-01-01");
  assert.equal(args.to, "2026-12-31");
  assert.equal(validateArgs(args).ok, true);
});

test("--from posterior a --to -> inválido", () => {
  const args = parseArgs(["dry-run", "--from=2026-12-31", "--to=2026-01-01"]);
  assert.equal(validateArgs(args).ok, false);
});

test("formato de fecha inválido -> inválido", () => {
  const args = parseArgs(["dry-run", "--from=01-01-2026"]);
  assert.equal(validateArgs(args).ok, false);
});

test("parity -> subcommand reconocido, parityMode por defecto 'both'", () => {
  const args = parseArgs(["parity"]);
  assert.equal(args.subcommand, "parity");
  assert.equal(args.parityMode, "both");
  assert.equal(validateArgs(args).ok, true);
});

test("parity --parity-mode=exact -> válido", () => {
  const args = parseArgs(["parity", "--parity-mode=exact"]);
  assert.equal(validateArgs(args).ok, true);
});

test("parity --parity-mode=invalid -> inválido", () => {
  const args = parseArgs(["parity", "--parity-mode=nonsense"]);
  assert.equal(validateArgs(args).ok, false);
});

test("subcomando desconocido -> subcommand null, inválido", () => {
  const args = parseArgs(["frobnicate"]);
  assert.equal(args.subcommand, null);
  assert.equal(validateArgs(args).ok, false);
});
