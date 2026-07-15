import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotes } from "../../src/contracts/notes-parser.js";

test("'termina en Abril/2025' -> fecha normalizada, issue si ya pasó", () => {
  const r = parseNotes("2 años de garantía - termina en Abril/2025\n-Gonzalo Hernán López Estay", "2026-07-13");
  assert.equal(r.warrantyEndDate, "2025-04-01");
  assert.equal(r.warrantyEndDateSource, "NOTES_PATTERN_MATCH");
  assert.equal(r.issues[0].issueType, "WARRANTY_END_DATE_PASSED");
});

test("'hasta DD/MM/AA' -> fecha normalizada; no confunde con otra fecha anterior en el texto", () => {
  const r = parseNotes("CAT firmado el 04/03/24 - Garantía hasta 04/03/26\n-Firma", "2026-07-13");
  assert.equal(r.warrantyEndDate, "2026-03-04");
});

test("fecha de garantía futura -> sin issue WARRANTY_END_DATE_PASSED", () => {
  const r = parseNotes("Garantía hasta 01/01/30", "2026-07-13");
  assert.equal(r.warrantyEndDate, "2030-01-01");
  assert.equal(r.issues.length, 0);
});

test("nota de desinstalación sin patrón de garantía -> sin fecha inventada", () => {
  const r = parseNotes("Equipo Desinstalado en Ago-2024\n-Gonzalo Hernán López Estay", "2026-07-13");
  assert.equal(r.warrantyEndDate, null);
  assert.equal(r.warrantyEndDateSource, "NONE");
});

test("nota sin ningún patrón reconocible -> sin fecha, sin issues", () => {
  const r = parseNotes("Tenemos SPA Gold - incluye todas las partes.\n-Firma Personal", "2026-07-13");
  assert.equal(r.warrantyEndDate, null);
  assert.deepEqual(r.issues, []);
});

test("Notas vacías/null -> sin fecha", () => {
  assert.equal(parseNotes(null, "2026-07-13").warrantyEndDate, null);
  assert.equal(parseNotes("", "2026-07-13").warrantyEndDate, null);
});
