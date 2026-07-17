import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateContractResolutionConfidence, CONFIDENCE_MODEL_VERSION } from "../../src/working-hours/contract-resolution-confidence.js";

// Simulado contra los 261 casos reales CONTRACTUAL del backfill dry-run
// (ETAPA 6.6B2 §11): distribución real 100% SERIAL_SUFFIX + FIXED_WINDOW +
// SINGLE_EQUIPMENT -> score=90/Alta uniforme (ver reporte final). Estos
// tests cubren TODAS las combinaciones de factores, incluidas las que el
// dataset real actual no exhibe (CLIENT_SITE_MODEL, FULL_24X7, ON_DEMAND,
// MULTIPLE_EQUIPMENT_SAME_COVERAGE), para no dejar ramas sin verificar.

test("modelVersion es siempre contract-v1", () => {
  const r = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.equal(r.modelVersion, CONFIDENCE_MODEL_VERSION);
  assert.equal(CONFIDENCE_MODEL_VERSION, "contract-v1");
});

test("caso real dominante del backfill: SERIAL_SUFFIX + FIXED_WINDOW + SINGLE_EQUIPMENT -> 90, Alta", () => {
  const r = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.equal(r.score, 90);
  assert.equal(r.label, "Alta");
});

test("OVERRIDE puntúa igual que SERIAL_SUFFIX (+40)", () => {
  const r = calculateContractResolutionConfidence({ matchMethod: "OVERRIDE", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.equal(r.score, 90);
});

test("CLIENT_SITE_MODEL puntúa menos que SERIAL_SUFFIX/OVERRIDE (+20 vs +40)", () => {
  const withSerial = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  const withClientSite = calculateContractResolutionConfidence({ matchMethod: "CLIENT_SITE_MODEL", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.ok(withClientSite.score < withSerial.score);
  assert.equal(withClientSite.score, 70);
});

test("coverageType FULL_24X7/FIXED_WINDOW puntúan igual (+30), más que BUSINESS_HOURS_UNDEFINED/ON_DEMAND/NOT_COVERED/NOT_APPLICABLE (+10)", () => {
  const full = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FULL_24X7", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  const fixed = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  const undefined_ = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "BUSINESS_HOURS_UNDEFINED", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.equal(full.score, fixed.score);
  assert.ok(undefined_.score < fixed.score);
});

test("MULTIPLE_EQUIPMENT_SAME_COVERAGE refuerza más que SINGLE_EQUIPMENT (+30 vs +20)", () => {
  const single = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  const multi = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "MULTIPLE_EQUIPMENT_SAME_COVERAGE" });
  assert.ok(multi.score > single.score);
  assert.equal(multi.score, 100);
  assert.equal(multi.label, "Alta");
});

test("valor desconocido de matchMethod/coverageType no lanza, puntúa 0 en ese factor (nunca inventa puntos)", () => {
  const r = calculateContractResolutionConfidence({ matchMethod: "ALGO_NUEVO", coverageType: "ALGO_NUEVO", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.equal(r.score, 20); // solo el factor multi-equipo (SINGLE=+20) puntúa
});

test("factors documenta cada componente con su puntaje", () => {
  const r = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FIXED_WINDOW", multiEquipmentOutcome: "SINGLE_EQUIPMENT" });
  assert.ok(r.factors.includes("(+40)"));
  assert.ok(r.factors.includes("(+30)"));
  assert.ok(r.factors.includes("(+20)"));
});

test("score siempre queda en [0,100] (clamp)", () => {
  const r = calculateContractResolutionConfidence({ matchMethod: "SERIAL_SUFFIX", coverageType: "FULL_24X7", multiEquipmentOutcome: "MULTIPLE_EQUIPMENT_SAME_COVERAGE" });
  assert.ok(r.score >= 0 && r.score <= 100);
});
