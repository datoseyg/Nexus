// HOTFIX de integridad de datos FieldBeat (post-Phase 6) - pruebas unitarias
// (sin DB) de lib/fieldbeat-part-occurrence.ts: shapePartOccurrence() (fila
// cruda de quality.fieldbeat_report_part_occurrences -> FieldbeatPartOccurrence)
// y buildPartSearchIdentity() (identidad de resultado de repuesto para
// Búsqueda - nunca fusiona por nombre genérico, ver plan).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapePartOccurrence, buildPartSearchIdentity, type RawPartOccurrenceRow } from "../../lib/fieldbeat-part-occurrence.ts";

function baseRow(overrides: Partial<RawPartOccurrenceRow> = {}): RawPartOccurrenceRow {
  return {
    used_part_id: "3453|1|0|CX1551G",
    fieldbeat_task_id: "3453",
    part_name: "Thyratron",
    raw_part_identifier: "CX1551G",
    normalized_part_identifier: "cx1551g",
    quantity: 1,
    origin_location: "Otros (Comente)",
    origin_comment: "Repuesto proporcionado por el cliente",
    photo_ref: "D5830A753933FF1FCD44A4839580A1D9.png",
    declaration_status: "DECLARED_IN_REPORT",
    catalog_match_status: "NO_MATCH",
    matched_product_id: null,
    matched_sku: null,
    matched_label: null,
    matched_barcode: null,
    candidate_dolibarr_product_ids: null,
    match_method: null,
    alias_value: null,
    alias_reason: null,
    alias_created_by: null,
    ...overrides
  };
}

test("shapePartOccurrence: caso 3453 (CX1551G/Thyratron, NO_MATCH) - rawPartNumber SIEMPRE visible, nunca enmascarado por rawName", () => {
  const occ = shapePartOccurrence(baseRow());
  assert.equal(occ.rawName, "Thyratron");
  assert.equal(occ.rawPartNumber, "CX1551G", "el número de parte real nunca se pierde ni se sustituye por el nombre");
  assert.equal(occ.sourceLocation, "Otros (Comente)");
  assert.equal(occ.sourceComment, "Repuesto proporcionado por el cliente");
  assert.equal(occ.declarationStatus, "DECLARED_IN_REPORT");
  assert.equal(occ.catalogMatchStatus, "NO_MATCH");
  assert.ok(occ.explanation.length > 0);
  assert.match(occ.explanation, /no significa que el repuesto no exista|sin correspondencia validada/i, "NO_MATCH nunca debe leerse como 'no existe'");
});

test("shapePartOccurrence: attachment expone filename pero bytesAvailable=false SIEMPRE (FieldBeat nunca entrega bytes localmente)", () => {
  const occ = shapePartOccurrence(baseRow());
  assert.deepEqual(occ.attachment, { filename: "D5830A753933FF1FCD44A4839580A1D9.png", bytesAvailable: false });
});

test("shapePartOccurrence: sin photo_ref -> attachment es null, nunca un objeto fantasma", () => {
  const occ = shapePartOccurrence(baseRow({ photo_ref: null }));
  assert.equal(occ.attachment, null);
});

test("shapePartOccurrence: cantidad ausente nunca se convierte en 0", () => {
  const occ = shapePartOccurrence(baseRow({ quantity: null }));
  assert.equal(occ.quantity, null);
});

test("shapePartOccurrence: AMBIGUOUS_MATCH expone matchEvidence.candidateProductIds, nunca un matchedProductId confirmado", () => {
  const occ = shapePartOccurrence(baseRow({ catalog_match_status: "AMBIGUOUS_MATCH", candidate_dolibarr_product_ids: "10776|10704", matched_product_id: null }));
  assert.deepEqual(occ.matchEvidence, { kind: "AMBIGUOUS_CANDIDATES", candidateProductIds: ["10776", "10704"] });
  assert.equal(occ.matchedProductId, null);
});

test("shapePartOccurrence: HISTORICAL_ALIAS_MATCH con evidencia real de alias expone matchEvidence.HISTORICAL_ALIAS", () => {
  const occ = shapePartOccurrence(
    baseRow({
      catalog_match_status: "HISTORICAL_ALIAS_MATCH",
      matched_product_id: "999",
      matched_sku: "REF-999",
      alias_value: "CX1551G-HIST",
      alias_reason: "curado por Fulano",
      alias_created_by: "fulano"
    })
  );
  assert.deepEqual(occ.matchEvidence, { kind: "HISTORICAL_ALIAS", aliasValue: "CX1551G-HIST", reason: "curado por Fulano", createdBy: "fulano" });
  assert.equal(occ.matchedProductId, "999");
  assert.equal(occ.matchedSku, "REF-999");
});

test("shapePartOccurrence: HISTORICAL_ALIAS_MATCH SIN evidencia real de alias (alias_value null) nunca inventa un alias en matchEvidence", () => {
  const occ = shapePartOccurrence(baseRow({ catalog_match_status: "HISTORICAL_ALIAS_MATCH", alias_value: null }));
  assert.deepEqual(occ.matchEvidence, { kind: "NONE" });
});

test("shapePartOccurrence: CURRENT_DIRECT_MATCH sin candidatos/alias -> matchEvidence.NONE", () => {
  const occ = shapePartOccurrence(baseRow({ catalog_match_status: "CURRENT_DIRECT_MATCH", matched_product_id: "500", matched_sku: "REF-500" }));
  assert.deepEqual(occ.matchEvidence, { kind: "NONE" });
  assert.equal(occ.matchedProductId, "500");
});

test("buildPartSearchIdentity: con producto de catálogo validado -> catalog-product:<id>, agrupable por producto", () => {
  const id = buildPartSearchIdentity({ lineId: "L1", rawPartNumber: "CX1551G", matchedProductId: "500" });
  assert.equal(id, "catalog-product:500");
});

test("buildPartSearchIdentity: sin match de catálogo pero CON número de parte -> raw-part:<código normalizado>, mismo código agrupa", () => {
  const id1 = buildPartSearchIdentity({ lineId: "L1", rawPartNumber: "CX1551G", matchedProductId: null });
  const id2 = buildPartSearchIdentity({ lineId: "L2", rawPartNumber: "cx1551g", matchedProductId: null });
  assert.equal(id1, "raw-part:cx1551g");
  assert.equal(id1, id2, "mismo código exacto (case-insensitive) debe producir la MISMA identidad, para agrupar ocurrencias reales del mismo repuesto");
});

test("buildPartSearchIdentity: SIN número de parte -> raw-occurrence:<lineId>, NUNCA fusiona por nombre genérico", () => {
  // Dos ocurrencias llamadas "Filtro" sin código, en reportes distintos -
  // deben producir identidades DISTINTAS (por lineId), nunca la misma.
  const filtro1 = buildPartSearchIdentity({ lineId: "900001|1|0|", rawPartNumber: null, matchedProductId: null });
  const filtro2 = buildPartSearchIdentity({ lineId: "900002|1|0|", rawPartNumber: null, matchedProductId: null });
  assert.equal(filtro1, "raw-occurrence:900001|1|0|");
  assert.equal(filtro2, "raw-occurrence:900002|1|0|");
  assert.notEqual(filtro1, filtro2, "dos ocurrencias sin código NUNCA deben fusionarse en una sola identidad solo por compartir nombre");
});

test("buildPartSearchIdentity: rawPartNumber vacío/solo espacios se trata como ausente (raw-occurrence:, nunca raw-part:)", () => {
  const id = buildPartSearchIdentity({ lineId: "L9", rawPartNumber: "   ", matchedProductId: null });
  assert.equal(id, "raw-occurrence:L9");
});
