import { test } from "node:test";
import assert from "node:assert/strict";
import { periodLabel } from "../../lib/fieldbeat-period-label.ts";

test("periodLabel formatea YYYY-MM a 'mmm YY' en es-CL", () => {
  assert.equal(periodLabel("2026-03"), "mar 26");
  assert.equal(periodLabel("2025-12"), "dic 25");
});

test("periodLabel: un período malformado se devuelve tal cual, nunca lanza", () => {
  assert.equal(periodLabel("bogus"), "bogus");
  assert.equal(periodLabel(""), "");
});
