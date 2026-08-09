// Ocurrencia canónica de repuesto (HOTFIX de integridad de datos FieldBeat,
// post-Phase 6, sql/088_fieldbeat_part_occurrences_and_participants.sql) -
// fuente única compartida por FieldBeat/Búsqueda/PDF/CSV. Separa PRESENCIA
// (declarationStatus) de CORRESPONDENCIA DE CATÁLOGO (catalogMatchStatus) -
// NO_MATCH significa ÚNICAMENTE "declarado, sin correspondencia validada en
// Dolibarr", NUNCA "no existe" ni "no fue declarado". rawName/rawPartNumber
// viajan SIEMPRE juntos - nunca se sustituyen entre sí.
import type { HistoricalPartMatchStatus } from "./fieldbeat-parts-history";
import type { FieldbeatPartAttachment, FieldbeatPartMatchEvidence, FieldbeatPartOccurrence, PartDeclarationStatus } from "@/types/fieldbeat-report-detail";

export interface RawPartOccurrenceRow {
  used_part_id: string;
  fieldbeat_task_id: string;
  part_name: string | null;
  raw_part_identifier: string | null;
  normalized_part_identifier: string | null;
  quantity: string | number | null;
  origin_location: string | null;
  origin_comment: string | null;
  photo_ref: string | null;
  declaration_status: PartDeclarationStatus;
  catalog_match_status: HistoricalPartMatchStatus | null;
  matched_product_id: string | null;
  matched_sku: string | null;
  matched_label: string | null;
  matched_barcode: string | null;
  candidate_dolibarr_product_ids: string | null;
  match_method: string | null;
  alias_value: string | null;
  alias_reason: string | null;
  alias_created_by: string | null;
}

// Explicación en lenguaje llano, fuente ÚNICA para las 5 superficies
// (FieldBeat/Búsqueda/PDF/CSV/drawer) - ninguna reinterpreta el enum por su
// cuenta. NO_MATCH deja explícito que "sin correspondencia validada" NUNCA
// significa "no existe" (defecto real que motivó este hotfix).
const CATALOG_MATCH_EXPLANATION: Record<HistoricalPartMatchStatus, string> = {
  CURRENT_DIRECT_MATCH: "Corresponde directamente a un producto vigente del catálogo Dolibarr.",
  HISTORICAL_ALIAS_MATCH: "Corresponde a un producto Dolibarr vía una equivalencia histórica curada manualmente.",
  DESCRIPTION_CONFIDENT_MATCH: "Corresponde a un producto Dolibarr vía una correspondencia de descripción verificada manualmente.",
  AMBIGUOUS_MATCH: "Declarado en el reporte, con más de un producto candidato en el catálogo - ninguno se asume como el correcto.",
  PLACEHOLDER_VALUE: "Declarado en el reporte con un valor placeholder (no es un número de parte real).",
  NO_MATCH: "Declarado en el reporte, sin correspondencia validada en el catálogo Dolibarr - esto no significa que el repuesto no exista.",
  // Declaración válida de ausencia de repuesto (N/A, no aplica, NC...) -
  // quality.classify_part_declaration (sql/098/086) - nunca requiere
  // revisión ni corrección de catálogo.
  NO_PART_USED: "El reporte declaró explícitamente que no se utilizó repuesto - no requiere corrección ni corresponde a un producto del catálogo."
};

function shapeAttachment(photoRef: string | null): FieldbeatPartAttachment | null {
  if (!photoRef) return null;
  // Confirmado (reporte 3453, campo "FOTO DEL REPUESTO UTILIZADO"): FieldBeat
  // solo entrega el nombre de archivo, nunca los bytes ni otra metadata -
  // bytesAvailable es SIEMPRE false hoy, no hay ninguna fuente local de los bytes.
  return { filename: photoRef, bytesAvailable: false };
}

function shapeMatchEvidence(row: RawPartOccurrenceRow): FieldbeatPartMatchEvidence {
  if (row.catalog_match_status === "AMBIGUOUS_MATCH" && row.candidate_dolibarr_product_ids) {
    return { kind: "AMBIGUOUS_CANDIDATES", candidateProductIds: row.candidate_dolibarr_product_ids.split("|").filter(Boolean) };
  }
  // Equivalencias históricas solo se muestran cuando existe evidencia REAL
  // en manual_review.part_aliases - nunca inventadas por el status solo.
  if (row.catalog_match_status === "HISTORICAL_ALIAS_MATCH" && row.alias_value) {
    return { kind: "HISTORICAL_ALIAS", aliasValue: row.alias_value, reason: row.alias_reason, createdBy: row.alias_created_by };
  }
  return { kind: "NONE" };
}

export function shapePartOccurrence(row: RawPartOccurrenceRow): FieldbeatPartOccurrence {
  const catalogMatchStatus = row.catalog_match_status ?? "NO_MATCH";
  return {
    lineId: row.used_part_id,
    fieldbeatTaskId: row.fieldbeat_task_id,
    rawName: row.part_name,
    rawPartNumber: row.raw_part_identifier,
    quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
    sourceLocation: row.origin_location,
    sourceComment: row.origin_comment,
    attachment: shapeAttachment(row.photo_ref),
    declarationStatus: row.declaration_status,
    catalogMatchStatus,
    matchedProductId: row.matched_product_id,
    matchedSku: row.matched_sku,
    matchEvidence: shapeMatchEvidence(row),
    explanation: CATALOG_MATCH_EXPLANATION[catalogMatchStatus]
  };
}

/**
 * Identidad de resultado de repuesto para Búsqueda (nunca fusiona por
 * nombre genérico - nombres como "filtro"/"cable"/"fusible" pueden
 * representar productos completamente distintos):
 *   - `catalog-product:<id>` solo con producto Dolibarr validado -agrupa
 *     ocurrencias del mismo producto real.
 *   - `raw-part:<código normalizado>` sin match de catálogo pero CON
 *     número de parte declarado -agrupa solo el MISMO código exacto.
 *   - `raw-occurrence:<lineId>` sin código -identidad POR OCURRENCIA
 *     individual, nunca agrupada automáticamente por nombre (evita
 *     fusionar dos "Filtro" distintos en una sola entidad ficticia).
 */
export function buildPartSearchIdentity(occurrence: Pick<FieldbeatPartOccurrence, "lineId" | "rawPartNumber" | "matchedProductId">): string {
  if (occurrence.matchedProductId) return `catalog-product:${occurrence.matchedProductId}`;
  const rawPartNumber = occurrence.rawPartNumber?.trim();
  if (rawPartNumber) return `raw-part:${rawPartNumber.toLowerCase()}`;
  return `raw-occurrence:${occurrence.lineId}`;
}
