import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEquipmentRecord } from "../../src/contracts/record-builder.js";
import { createClientNameNormalizer } from "../../src/contracts/normalize-client.js";

test("NO_CONTRACT + N/A es ausencia contractual explícita, no horario faltante", () => {
  const row = [
    "Sanatorio Alemán", "SA", "Precise", "105614", "ago-2015",
    "Sin Contrato", "Silver (Sólo Soporte)", "No", "No", "N/A", "N/A",
    "No", "No", "No", "Todo Incluido", "-", "Nota histórica"
  ];
  while (row.length < 24) row.push("");

  const record = buildEquipmentRecord(
    { row, sourceRowNumber: 1 },
    "2026-01-01",
    createClientNameNormalizer()
  );

  assert.equal(record.normalizedFields.contractStatusCode, "NO_CONTRACT");
  assert.equal(record.coverageType, "NOT_APPLICABLE");
  assert.equal(record.serviceWindowRows.length, 0);
  assert.equal(record.normalizedFields.partsCoverageCode, "FULL_COVERAGE");
  assert.ok(!record.issues.some(issue => issue.issueType === "MISSING_ATTENTION_SCHEDULE"));
  assert.equal(record.normalizationStatus, "OK");
});
