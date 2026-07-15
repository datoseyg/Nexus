import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookupNormalizer } from "../../src/contracts/lookup-normalizer.js";
import { normalizeContractStatus, normalizeHwRefresh } from "../../src/contracts/normalize-vocab-fields.js";

test("createLookupNormalizer: hit real, fallback UNKNOWN con issue, vacío sin issue", () => {
  const normalize = createLookupNormalizer({ map: { A: "CODE_A" }, fallbackCode: "UNKNOWN", issueType: "UNMAPPED_ENUM_VALUE" });

  assert.deepEqual(normalize("A"), { code: "CODE_A", raw: "A", issues: [] });

  const unmapped = normalize("Z");
  assert.equal(unmapped.code, "UNKNOWN");
  assert.equal(unmapped.raw, "Z");
  assert.equal(unmapped.issues[0].issueType, "UNMAPPED_ENUM_VALUE");

  assert.deepEqual(normalize(""), { code: "UNKNOWN", raw: null, issues: [] });
});

test("normalizeContractStatus: corrige el typo 'Desintalado' -> DEINSTALLED solo en el código, no en raw", () => {
  const r = normalizeContractStatus("Desintalado");
  assert.equal(r.code, "DEINSTALLED");
  assert.equal(r.raw, "Desintalado"); // el raw NUNCA se corrige
  assert.equal(r.issues.length, 0);
});

test("normalizeContractStatus: 'Equipo Desinstalado' también mapea a DEINSTALLED", () => {
  assert.equal(normalizeContractStatus("Equipo Desinstalado").code, "DEINSTALLED");
});

test("normalizeHwRefresh: comparte vocabulario YES/NO/SW_ONLY/CONDITIONAL_SW", () => {
  assert.equal(normalizeHwRefresh("Sí").code, "YES");
  assert.equal(normalizeHwRefresh("No").code, "NO");
  assert.equal(normalizeHwRefresh("Sólo SW").code, "SW_ONLY");
  assert.equal(normalizeHwRefresh("Sólo si el nuevo SW lo requiere").code, "CONDITIONAL_SW");
});
