import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateArgs } from "../../src/working-hours/cli.js";

test("por defecto -> modo dry-run", () => {
  const args = parseArgs([]);
  assert.equal(args.mode, "dry-run");
});

test("--apply explícito con --from -> modo apply", () => {
  const args = parseArgs(["--from=2026-01-01", "--apply"]);
  assert.equal(args.mode, "apply");
});

test("--dry-run gana sobre --apply si ambos están presentes", () => {
  const args = parseArgs(["--from=2026-01-01", "--dry-run", "--apply"]);
  assert.equal(args.mode, "dry-run");
});

test("validateArgs: --apply sin --from ni --to -> inválido (nunca backfill total implícito)", () => {
  const r = validateArgs({ from: null, to: null, mode: "apply" });
  assert.equal(r.ok, false);
});

test("validateArgs: --apply con --from -> válido", () => {
  const r = validateArgs({ from: "2026-01-01", to: null, mode: "apply" });
  assert.equal(r.ok, true);
});

test("validateArgs: --from posterior a --to -> inválido", () => {
  const r = validateArgs({ from: "2026-12-31", to: "2026-01-01", mode: "dry-run" });
  assert.equal(r.ok, false);
});

test("validateArgs: formato de fecha inválido -> inválido", () => {
  const r = validateArgs({ from: "01-01-2026", to: null, mode: "dry-run" });
  assert.equal(r.ok, false);
});

test("validateArgs: dry-run sin rango -> válido (opcional)", () => {
  const r = validateArgs({ from: null, to: null, mode: "dry-run" });
  assert.equal(r.ok, true);
});
