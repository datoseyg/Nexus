import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEquipmentItems } from "../../lib/fieldbeat-equipment-derivation.ts";

test("STRUCTURED_IDENTIFIED: divide equipmentInternalIds por '|', todos confirmed", () => {
  const items = deriveEquipmentItems({
    equipmentInternalIds: "EQ-901|EQ-902",
    teamIdentificationStatus: "STRUCTURED_IDENTIFIED",
    matchedCandidateIds: null
  });
  assert.deepEqual(items, [
    { internalId: "EQ-901", source: "STRUCTURED", confirmed: true },
    { internalId: "EQ-902", source: "STRUCTURED", confirmed: true }
  ]);
});

test("STRUCTURED_IDENTIFIED con un solo equipo (sin '|') produce un único item", () => {
  const items = deriveEquipmentItems({ equipmentInternalIds: "EQ-901", teamIdentificationStatus: "STRUCTURED_IDENTIFIED", matchedCandidateIds: null });
  assert.deepEqual(items, [{ internalId: "EQ-901", source: "STRUCTURED", confirmed: true }]);
});

test("TEXT_CONFIDENT_IDENTIFIED: exactamente 1 candidato, confirmed=true, source=TEXT_RECOVERED", () => {
  const items = deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "TEXT_CONFIDENT_IDENTIFIED", matchedCandidateIds: ["EQ-901"] });
  assert.deepEqual(items, [{ internalId: "EQ-901", source: "TEXT_RECOVERED", confirmed: true }]);
});

test("TEXT_AMBIGUOUS: TODOS los candidatos aparecen, ninguno confirmed (nunca se promueve una ambigüedad a match)", () => {
  const items = deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "TEXT_AMBIGUOUS", matchedCandidateIds: ["EQ-901", "EQ-902"] });
  assert.deepEqual(items, [
    { internalId: "EQ-901", source: "TEXT_AMBIGUOUS_CANDIDATE", confirmed: false },
    { internalId: "EQ-902", source: "TEXT_AMBIGUOUS_CANDIDATE", confirmed: false }
  ]);
});

test("MISSING: arreglo vacío, nunca un item inventado", () => {
  assert.deepEqual(deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "MISSING", matchedCandidateIds: null }), []);
});

test("NOT_APPLICABLE: arreglo vacío (motivo se comunica aparte, no como equipo fantasma)", () => {
  assert.deepEqual(deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "NOT_APPLICABLE", matchedCandidateIds: null }), []);
});

test("STRUCTURED_IDENTIFIED con equipmentInternalIds vacío o null nunca lanza, produce []", () => {
  assert.deepEqual(deriveEquipmentItems({ equipmentInternalIds: "", teamIdentificationStatus: "STRUCTURED_IDENTIFIED", matchedCandidateIds: null }), []);
  assert.deepEqual(deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "STRUCTURED_IDENTIFIED", matchedCandidateIds: null }), []);
});

test("TEXT_CONFIDENT_IDENTIFIED sin candidatos (matchedCandidateIds vacío/null) nunca lanza, produce []", () => {
  assert.deepEqual(deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "TEXT_CONFIDENT_IDENTIFIED", matchedCandidateIds: null }), []);
  assert.deepEqual(deriveEquipmentItems({ equipmentInternalIds: null, teamIdentificationStatus: "TEXT_CONFIDENT_IDENTIFIED", matchedCandidateIds: [] }), []);
});
