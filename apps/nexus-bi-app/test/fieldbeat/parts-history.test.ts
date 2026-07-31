import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHistoricalPartMatch, isFullyTraceableReport, type PartAlias } from "../../lib/fieldbeat-parts-history.ts";

function baseInput(overrides: Partial<Parameters<typeof classifyHistoricalPartMatch>[0]> = {}) {
  return {
    matchStatus: "MATCHED" as const,
    rawPartIdentifier: "ABC-123",
    normalizedPartIdentifier: "abc123",
    activeAliases: [] as PartAlias[],
    ...overrides
  };
}

test("MATCHED sin alias es CURRENT_DIRECT_MATCH", () => {
  const result = classifyHistoricalPartMatch(baseInput());
  assert.equal(result.status, "CURRENT_DIRECT_MATCH");
});

test("AMBIGUOUS_MATCH nunca se resuelve vía alias, aunque exista uno aplicable", () => {
  const alias: PartAlias = { aliasValue: "abc-123", aliasType: "RAW", dolibarrProductId: 42, active: true };
  const result = classifyHistoricalPartMatch(baseInput({ matchStatus: "AMBIGUOUS_MATCH", activeAliases: [alias] }));
  assert.equal(result.status, "AMBIGUOUS_MATCH");
  assert.equal(result.resolvedDolibarrProductId, null);
});

test("PLACEHOLDER_VALUE se mantiene tal cual, sin aplicar alias", () => {
  const alias: PartAlias = { aliasValue: "abc-123", aliasType: "RAW", dolibarrProductId: 42, active: true };
  const result = classifyHistoricalPartMatch(baseInput({ matchStatus: "PLACEHOLDER_VALUE", activeAliases: [alias] }));
  assert.equal(result.status, "PLACEHOLDER_VALUE");
});

test("NO_MATCH con alias RAW activo resuelve a HISTORICAL_ALIAS_MATCH", () => {
  const alias: PartAlias = { aliasValue: "abc-123", aliasType: "RAW", dolibarrProductId: 42, active: true };
  const result = classifyHistoricalPartMatch(baseInput({ matchStatus: "NO_MATCH", activeAliases: [alias] }));
  assert.equal(result.status, "HISTORICAL_ALIAS_MATCH");
  assert.equal(result.resolvedDolibarrProductId, 42);
  assert.equal(result.aliasApplied?.dolibarrProductId, 42);
});

test("NO_MATCH con alias inactivo NO resuelve (se ignora)", () => {
  const alias: PartAlias = { aliasValue: "abc-123", aliasType: "RAW", dolibarrProductId: 42, active: false };
  const result = classifyHistoricalPartMatch(baseInput({ matchStatus: "NO_MATCH", activeAliases: [alias] }));
  assert.equal(result.status, "NO_MATCH");
});

test("NO_MATCH con alias NORMALIZED compara contra normalizedPartIdentifier, no raw", () => {
  const alias: PartAlias = { aliasValue: "abc123", aliasType: "NORMALIZED", dolibarrProductId: 7, active: true };
  const result = classifyHistoricalPartMatch(baseInput({ matchStatus: "NO_MATCH", rawPartIdentifier: "ABC 123!!", activeAliases: [alias] }));
  assert.equal(result.status, "HISTORICAL_ALIAS_MATCH");
  assert.equal(result.resolvedDolibarrProductId, 7);
});

test("NO_MATCH sin alias y sin override queda NO_MATCH (nunca se inventa un match)", () => {
  const result = classifyHistoricalPartMatch(baseInput({ matchStatus: "NO_MATCH" }));
  assert.equal(result.status, "NO_MATCH");
  assert.equal(result.resolvedDolibarrProductId, null);
});

test("NO_MATCH con descriptionConfidentOverride explícito resuelve a DESCRIPTION_CONFIDENT_MATCH", () => {
  const result = classifyHistoricalPartMatch(
    baseInput({ matchStatus: "NO_MATCH", descriptionConfidentOverride: { dolibarrProductId: 99, evidence: "curado manualmente" } })
  );
  assert.equal(result.status, "DESCRIPTION_CONFIDENT_MATCH");
  assert.equal(result.resolvedDolibarrProductId, 99);
});

test("isFullyTraceableReport: todas las líneas trazables => true", () => {
  assert.equal(isFullyTraceableReport(["CURRENT_DIRECT_MATCH", "HISTORICAL_ALIAS_MATCH"]), true);
});

test("isFullyTraceableReport: una sola línea NO_MATCH invalida todo el reporte", () => {
  assert.equal(isFullyTraceableReport(["CURRENT_DIRECT_MATCH", "NO_MATCH"]), false);
});

test("isFullyTraceableReport: reporte sin líneas de repuesto no es trazable (no aplica un universo vacío)", () => {
  assert.equal(isFullyTraceableReport([]), false);
});

// Decisión de dominio (sql/098): NO_PART_USED es una declaración válida de
// cero repuestos, nunca "pendiente de resolver" - un reporte cuyas líneas
// son solo matches reales y/o declaraciones válidas de ausencia de
// repuesto es completamente trazable.
test("isFullyTraceableReport: NO_PART_USED cuenta como trazable, solo o mezclado con matches reales", () => {
  assert.equal(isFullyTraceableReport(["NO_PART_USED"]), true);
  assert.equal(isFullyTraceableReport(["CURRENT_DIRECT_MATCH", "NO_PART_USED"]), true);
});

test("isFullyTraceableReport: NO_PART_USED nunca enmascara una línea PLACEHOLDER_VALUE/NO_MATCH real en el mismo reporte", () => {
  assert.equal(isFullyTraceableReport(["NO_PART_USED", "PLACEHOLDER_VALUE"]), false);
  assert.equal(isFullyTraceableReport(["NO_PART_USED", "NO_MATCH"]), false);
});
