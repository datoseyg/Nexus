import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInstallationDate } from "../../src/contracts/normalize-install-date.js";

test("mes-año de 4 letras (ago-2015)", () => {
  const r = parseInstallationDate("ago-2015");
  assert.equal(r.installationMonth, "2015-08-01");
  assert.equal(r.installationDatePrecision, "MONTH");
  assert.equal(r.issues.length, 0);
});

test("mes-año con año de 2 dígitos (nov-24)", () => {
  const r = parseInstallationDate("nov-24");
  assert.equal(r.installationMonth, "2024-11-01");
  assert.equal(r.installationDatePrecision, "MONTH");
});

test("mes de 4 letras real del archivo (sept-2021)", () => {
  const r = parseInstallationDate("sept-2021");
  assert.equal(r.installationMonth, "2021-09-01");
  assert.equal(r.installationDatePrecision, "MONTH");
});

test("año aislado (2009) -> 1 de enero, precisión YEAR", () => {
  const r = parseInstallationDate("2009");
  assert.equal(r.installationMonth, "2009-01-01");
  assert.equal(r.installationDatePrecision, "YEAR");
});

test("vacío -> null + issue INVALID_INSTALLATION_DATE", () => {
  const r = parseInstallationDate("");
  assert.equal(r.installationMonth, null);
  assert.equal(r.installationDatePrecision, "UNKNOWN");
  assert.equal(r.issues[0].issueType, "INVALID_INSTALLATION_DATE");
});

test("basura no reconocida -> null + issue, nunca inventa una fecha", () => {
  const r = parseInstallationDate("no-es-una-fecha");
  assert.equal(r.installationMonth, null);
  assert.equal(r.installationDatePrecision, "UNKNOWN");
  assert.equal(r.issues[0].issueType, "INVALID_INSTALLATION_DATE");
});
