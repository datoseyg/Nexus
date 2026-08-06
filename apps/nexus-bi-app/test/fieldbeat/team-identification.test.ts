import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyequipmentIdentification, tokenizeDescription } from "../../lib/fieldbeat-equipment-identification.ts";

test("campo estructurado presente gana siempre, incluso con texto ambiguo", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: ["monaco06"],
    description: "revision de monaco06 y monaco07",
    candidates: [{ id: "monaco06" }, { id: "monaco07" }]
  });
  assert.equal(result.status, "STRUCTURED_IDENTIFIED");
  assert.deepEqual(result.matchedCandidateIds, ["monaco06"]);
});

test("un único candidato recuperado del texto es TEXT_CONFIDENT_IDENTIFIED", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: [],
    description: "revision de monaco06 por alerta de ciberseguridad",
    candidates: [{ id: "monaco06" }, { id: "monaco09" }]
  });
  assert.equal(result.status, "TEXT_CONFIDENT_IDENTIFIED");
  assert.deepEqual(result.matchedCandidateIds, ["monaco06"]);
});

test("dos candidatos mencionados en el texto es TEXT_AMBIGUOUS", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: [],
    description: "revision de monaco06 y monaco09 en la misma visita",
    candidates: [{ id: "monaco06" }, { id: "monaco09" }]
  });
  assert.equal(result.status, "TEXT_AMBIGUOUS");
  assert.deepEqual([...result.matchedCandidateIds].sort(), ["monaco06", "monaco09"]);
});

test("sin estructurado, sin match de texto y sin motivo NOT_APPLICABLE es MISSING", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: [],
    description: "Apoyo remoto Andes Salud",
    candidates: [{ id: "monaco06" }]
  });
  assert.equal(result.status, "MISSING");
});

test("descripción vacía o null es MISSING, nunca lanza", () => {
  assert.equal(
    classifyequipmentIdentification({ structuredEquipmentIds: [], description: null, candidates: [{ id: "monaco06" }] }).status,
    "MISSING"
  );
  assert.equal(
    classifyequipmentIdentification({ structuredEquipmentIds: [], description: "   ", candidates: [{ id: "monaco06" }] }).status,
    "MISSING"
  );
});

test("NOT_APPLICABLE solo se acepta cuando el caller ya lo demuestra explícitamente", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: [],
    description: "diagnostico remoto sin visita a sitio",
    candidates: [],
    notApplicableReason: "task_type=REMOTE_SUPPORT sin equipo físico, confirmado por regla de dominio X"
  });
  assert.equal(result.status, "NOT_APPLICABLE");
  assert.ok(result.evidence?.includes("REMOTE_SUPPORT"));
});

test("candidatos cortos (<3 chars) no generan match para evitar ruido", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: [],
    description: "cambio de ps unidad principal",
    candidates: [{ id: "ps" }]
  });
  assert.equal(result.status, "MISSING");
});

test("tokenizeDescription separa por no-alfanumérico (guion incluido como parte del token) y filtra tokens < 3 chars", () => {
  // "revisión" -> "revisi"+"n" (la ó no-ascii separa); "de"(2) queda filtrado por longitud;
  // "equipo-01" se mantiene ENTERO (el guion ya no separa, ver internal_id reales con guion).
  assert.deepEqual(tokenizeDescription("Revisión de Tornillo PS1, equipo-01"), ["revisi", "tornillo", "ps1", "equipo-01"]);
});

test("tokenizeDescription preserva códigos de equipo con guion como un solo token recuperable", () => {
  const result = classifyequipmentIdentification({
    structuredEquipmentIds: [],
    description: "cambio de tubo en Linac-153935 turno tarde",
    candidates: [{ id: "Linac-153935" }, { id: "TPS-UC" }]
  });
  assert.equal(result.status, "TEXT_CONFIDENT_IDENTIFIED");
  assert.deepEqual(result.matchedCandidateIds, ["Linac-153935"]);
});
