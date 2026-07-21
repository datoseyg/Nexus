import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateArgs } from "../../src/contracts/cli.js";

test("por defecto (sin --dry-run ni --apply) -> modo dry-run", () => {
  const args = parseArgs(["--file=x.csv"]);
  assert.equal(args.mode, "dry-run");
});

test("--apply explícito -> modo apply", () => {
  const args = parseArgs(["--file=x.csv", "--effective-date=2026-01-01", "--apply"]);
  assert.equal(args.mode, "apply");
});

test("--dry-run gana sobre --apply si ambos están presentes (nunca --apply implícito)", () => {
  const args = parseArgs(["--file=x.csv", "--dry-run", "--apply"]);
  assert.equal(args.mode, "dry-run");
});

test("validateArgs: falta --file -> inválido", () => {
  const r = validateArgs({ file: null, effectiveDate: null, mode: "dry-run" });
  assert.equal(r.ok, false);
});

test("validateArgs: --apply sin --effective-date -> inválido", () => {
  const r = validateArgs({ file: "x.csv", effectiveDate: null, mode: "apply" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /effective-date/);
});

test("validateArgs: dry-run sin --effective-date -> válido (opcional)", () => {
  const r = validateArgs({ file: "x.csv", effectiveDate: null, mode: "dry-run" });
  assert.equal(r.ok, true);
});

test("validateArgs: formato de fecha inválido -> inválido", () => {
  const r = validateArgs({ file: "x.csv", effectiveDate: "13-07-2026", mode: "dry-run" });
  assert.equal(r.ok, false);
});

test("validateArgs: --apply con --effective-date válida -> válido", () => {
  const r = validateArgs({ file: "x.csv", effectiveDate: "2026-07-13", mode: "apply" });
  assert.equal(r.ok, true);
});
