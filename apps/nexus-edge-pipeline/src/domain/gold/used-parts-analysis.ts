// Constructor GOLD - GOLD_Used_Parts_Analysis: catalogo de calidad de
// matching de repuestos (ver GOLD_DATA_CONTRACT.md). A diferencia de las
// demas tablas GOLD, NO esta acotado a tickets Zendesk accesibles: cubre
// el universo GLOBAL de Used_Parts_Dolibarr_Match.csv (MARTS #1, todas
// las tasks FieldBeat). Equivalente puro de buildUsedPartsAnalysis() en
// build-gold.js.
//
// PURO: no importa nada de R2/Queues/Cloudflare/D1, no hace I/O.

import { isTrue } from "../marts/lib";
import type { UsedPartsMatchMartRow } from "./lib";

export interface UsedPartsAnalysisRow extends Record<string, unknown> {
  normalized_part_identifier: string;
  raw_part_identifier: string;
  part_name: string;
  occurrences: number;
  matched_count: number;
  placeholder_count: number;
  no_match_count: number;
  ambiguous_count: number;
  dolibarr_refs: string;
  dolibarr_product_ids: string;
  match_statuses: string;
  match_methods: string;
  needs_manual_review: boolean;
}

interface PartGroupAccumulator {
  rawIdentifiers: Set<string>;
  partNames: Set<string>;
  occurrences: number;
  matchedCount: number;
  placeholderCount: number;
  noMatchCount: number;
  ambiguousCount: number;
  dolibarrRefs: Set<string>;
  dolibarrProductIds: Set<string>;
  matchStatuses: Set<string>;
  matchMethods: Set<string>;
  needsManualReview: boolean;
}

function emptyAccumulator(): PartGroupAccumulator {
  return {
    rawIdentifiers: new Set(),
    partNames: new Set(),
    occurrences: 0,
    matchedCount: 0,
    placeholderCount: 0,
    noMatchCount: 0,
    ambiguousCount: 0,
    dolibarrRefs: new Set(),
    dolibarrProductIds: new Set(),
    matchStatuses: new Set(),
    matchMethods: new Set(),
    needsManualReview: false
  };
}

// Una unica pasada O(n) sobre el catalogo global de repuestos, agrupando
// por `normalized_part_identifier` en un Map - los Set() por grupo
// deduplican variantes (raw identifiers, nombres, refs) sin necesitar un
// segundo recorrido con `.includes()` (que seria O(n) por insercion,
// O(n^2) en total).
export function buildUsedPartsAnalysis(usedPartRows: UsedPartsMatchMartRow[]): UsedPartsAnalysisRow[] {
  const groups = new Map<string, PartGroupAccumulator>();

  for (const row of usedPartRows) {
    const key = row.normalized_part_identifier || "(vacio)";
    const group = groups.get(key) ?? emptyAccumulator();

    group.occurrences += 1;

    if (row.raw_part_identifier) group.rawIdentifiers.add(row.raw_part_identifier);
    if (row.part_name) group.partNames.add(row.part_name);
    if (row.dolibarr_ref) group.dolibarrRefs.add(row.dolibarr_ref);
    if (row.dolibarr_product_id) group.dolibarrProductIds.add(row.dolibarr_product_id);
    if (row.match_status) group.matchStatuses.add(row.match_status);
    if (row.match_method) group.matchMethods.add(row.match_method);

    if (row.match_status === "MATCHED") group.matchedCount += 1;
    if (row.match_status === "PLACEHOLDER_VALUE") group.placeholderCount += 1;
    if (row.match_status === "NO_MATCH") group.noMatchCount += 1;
    if (row.match_status === "AMBIGUOUS_MATCH") group.ambiguousCount += 1;

    if (isTrue(row.needs_manual_review)) group.needsManualReview = true;

    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([normalizedPartIdentifier, g]) => ({
      normalized_part_identifier: normalizedPartIdentifier,
      raw_part_identifier: Array.from(g.rawIdentifiers).join("|"),
      part_name: Array.from(g.partNames).join("|"),
      occurrences: g.occurrences,
      matched_count: g.matchedCount,
      placeholder_count: g.placeholderCount,
      no_match_count: g.noMatchCount,
      ambiguous_count: g.ambiguousCount,
      dolibarr_refs: Array.from(g.dolibarrRefs).join("|"),
      dolibarr_product_ids: Array.from(g.dolibarrProductIds).join("|"),
      match_statuses: Array.from(g.matchStatuses).join("|"),
      match_methods: Array.from(g.matchMethods).join("|"),
      needs_manual_review: g.needsManualReview
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}
