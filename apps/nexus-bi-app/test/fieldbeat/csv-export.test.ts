import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeCsvCell } from "../../lib/csv-export.ts";

test("escapeCsvCell: null/undefined -> celda vacía", () => {
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(undefined), "");
});

test("escapeCsvCell: comas/comillas/saltos de línea se citan según RFC 4180", () => {
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell('a"b'), '"a""b"');
  assert.equal(escapeCsvCell("a\nb"), '"a\nb"');
});

test("escapeCsvCell: formula-injection - =, +, -, @, tab al inicio se neutralizan con apóstrofe", () => {
  assert.equal(escapeCsvCell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assert.equal(escapeCsvCell("+1234"), "'+1234");
  assert.equal(escapeCsvCell("-1234"), "'-1234");
  assert.equal(escapeCsvCell("@cmd"), "'@cmd");
  assert.equal(escapeCsvCell("\tSUM"), "'\tSUM");
});

test("escapeCsvCell: un = en medio de la celda (no al inicio) no dispara el prefijo", () => {
  assert.equal(escapeCsvCell("a=b"), "a=b");
});

test("escapeCsvCell: valor neutralizado que ADEMÁS contiene una coma se cita completo (apóstrofe incluido)", () => {
  assert.equal(escapeCsvCell("=A1,A2"), '"\'=A1,A2"');
});
