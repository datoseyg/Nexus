// Declaraciones TypeScript para src/resolvers/part-identity-resolver.js.
// Describe exactamente los exports reales del módulo -sin `any`- para que
// los importadores tipados (test/audit/*.integration.test.ts) dejen de
// depender de un `any` implícito (TS7016).

export function normalizeIdentifier(value: unknown): string;

// Literales que no representan un identificador real de repuesto (algunos
// significan "no se utilizó repuesto", otros solo "no se informó el
// identificador" - ver quality.classify_part_declaration para esa
// distinción posterior). Todos producen match_status="PLACEHOLDER_VALUE".
export const PLACEHOLDER_LITERALS: readonly string[];

export type PartMatchStatus = "MATCHED" | "NO_MATCH" | "AMBIGUOUS_MATCH" | "PLACEHOLDER_VALUE";

export interface PartIdentityResult {
  raw_part_identifier: string;
  normalized_part_identifier: string;
  dolibarr_product_id: string;
  dolibarr_ref: string;
  dolibarr_barcode: string;
  dolibarr_label: string;
  match_method: string;
  match_confidence: number;
  match_status: PartMatchStatus;
  needs_manual_review: boolean;
  candidate_dolibarr_product_ids: string;
}

export interface PartIdentityMapRow {
  identity_type: "REF" | "BARCODE" | "ID";
  identity_value: string | null;
  identity_value_normalized: string | null;
  dolibarr_product_id: string;
  dolibarr_ref?: string | null;
  dolibarr_barcode?: string | null;
  dolibarr_label?: string | null;
}

export interface PartIdentityAliasRow {
  alias_value: string | null;
  alias_type: string | null;
  dolibarr_product_id: string | null;
  dolibarr_ref?: string | null;
}

// Cascada de resolución de identidad: alias manual -> placeholder -> match
// automático (REF/BARCODE/ID exacto -> normalizado -> REF_LIKE) -> NO_MATCH.
export function resolvePartIdentity(
  rawValue: unknown,
  identityMap: readonly PartIdentityMapRow[],
  aliasRows?: readonly PartIdentityAliasRow[]
): PartIdentityResult;
