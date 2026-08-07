// Trazabilidad histórica de repuestos (Gate B §2.5, Gate C §13).
// marts.used_parts_dolibarr_match.match_status ya trae 4 valores reales
// (reconciliación local, 24-jul-2026): MATCHED(927) PLACEHOLDER_VALUE(721)
// NO_MATCH(489) AMBIGUOUS_MATCH(56) - todo MATCHED hoy es match directo
// contra el catálogo Dolibarr ACTUAL (match_method: REF_EXACT/
// REF_NORMALIZED_EXACT/REF_LIKE, ver processed.dolibarr_product_identity_map
// que solo mapea REF/ID/BARCODE del producto vigente, sin ninguna columna
// de vigencia/histórico).
//
// manual_review.part_aliases SÍ tiene la forma correcta para resolver un
// repuesto histórico (alias_value/alias_type/dolibarr_product_id/active,
// con reason+created_by auditables) pero está VACÍA (0 filas) en el
// dataset reconciliado - nadie ha curado todavía una equivalencia
// histórica real. HISTORICAL_ALIAS_MATCH por lo tanto es una rama
// implementada pero hoy inalcanzable con datos reales; no se rellena con
// heurísticas propias (Gate C §13: "no inventes equivalencias
// históricas").
//
// DESCRIPTION_CONFIDENT_MATCH no tiene ninguna fuente determinista todavía
// (no existe reglas de matching de texto libre contra part_name auditadas)
// - se deja en el vocabulario para no reescribir el contrato después, pero
// solo se alcanza vía descriptionConfidentOverride, nunca inferido acá.

export type PartMatchStatus = "MATCHED" | "PLACEHOLDER_VALUE" | "NO_MATCH" | "AMBIGUOUS_MATCH";

export type HistoricalPartMatchStatus =
  | "CURRENT_DIRECT_MATCH"
  | "HISTORICAL_ALIAS_MATCH"
  | "DESCRIPTION_CONFIDENT_MATCH"
  | "AMBIGUOUS_MATCH"
  | "PLACEHOLDER_VALUE"
  | "NO_MATCH"
  // Declaración válida de ausencia de repuesto (N/A, no aplica, NC...) -
  // quality.classify_part_declaration (sql/098/086). Nunca inferida acá en
  // TS - viene tal cual de quality.fieldbeat_used_part_match.historical_match_status
  // (SQL), que es la única fuente de verdad para esta reclasificación.
  | "NO_PART_USED";

export interface PartAlias {
  aliasValue: string;
  aliasType: "RAW" | "NORMALIZED";
  dolibarrProductId: number;
  active: boolean;
}

export interface PartMatchClassificationInput {
  matchStatus: PartMatchStatus;
  rawPartIdentifier: string | null;
  normalizedPartIdentifier: string | null;
  /** Filas de manual_review.part_aliases ya filtradas por active=true. */
  activeAliases: readonly PartAlias[];
  /** Evidencia ya demostrada (curaduría manual), nunca inferencia de texto libre acá. */
  descriptionConfidentOverride?: { dolibarrProductId: number; evidence: string } | null;
}

export interface PartMatchClassificationResult {
  status: HistoricalPartMatchStatus;
  resolvedDolibarrProductId: number | null;
  aliasApplied: PartAlias | null;
}

function findAliasMatch(input: PartMatchClassificationInput): PartAlias | null {
  const raw = input.rawPartIdentifier?.trim().toLowerCase();
  const normalized = input.normalizedPartIdentifier?.trim().toLowerCase();

  for (const alias of input.activeAliases) {
    if (!alias.active) continue;
    const aliasValue = alias.aliasValue.trim().toLowerCase();
    if (alias.aliasType === "RAW" && raw && aliasValue === raw) return alias;
    if (alias.aliasType === "NORMALIZED" && normalized && aliasValue === normalized) return alias;
  }
  return null;
}

export function classifyHistoricalPartMatch(input: PartMatchClassificationInput): PartMatchClassificationResult {
  // La ambigüedad nunca se resuelve vía alias - un alias asume una
  // correspondencia única y determinista; aplicarlo sobre un caso ya
  // ambiguo ocultaría el problema real en lugar de resolverlo.
  if (input.matchStatus === "AMBIGUOUS_MATCH") {
    return { status: "AMBIGUOUS_MATCH", resolvedDolibarrProductId: null, aliasApplied: null };
  }

  if (input.matchStatus === "PLACEHOLDER_VALUE") {
    return { status: "PLACEHOLDER_VALUE", resolvedDolibarrProductId: null, aliasApplied: null };
  }

  if (input.matchStatus === "MATCHED") {
    return { status: "CURRENT_DIRECT_MATCH", resolvedDolibarrProductId: null, aliasApplied: null };
  }

  // input.matchStatus === "NO_MATCH"
  const aliasMatch = findAliasMatch(input);
  if (aliasMatch) {
    return { status: "HISTORICAL_ALIAS_MATCH", resolvedDolibarrProductId: aliasMatch.dolibarrProductId, aliasApplied: aliasMatch };
  }

  if (input.descriptionConfidentOverride) {
    return {
      status: "DESCRIPTION_CONFIDENT_MATCH",
      resolvedDolibarrProductId: input.descriptionConfidentOverride.dolibarrProductId,
      aliasApplied: null
    };
  }

  return { status: "NO_MATCH", resolvedDolibarrProductId: null, aliasApplied: null };
}

/**
 * Un reporte es completamente trazable solo cuando TODAS sus líneas
 * resuelven a un match real (directo, histórico o de descripción
 * confiable) o son una declaración válida de ausencia de repuesto - una
 * sola línea NO_MATCH/AMBIGUOUS_MATCH/PLACEHOLDER_VALUE basta para que el
 * reporte completo no sea trazable (Gate B §2.5). Mismo criterio que
 * quality.fieldbeat_report_parts_summary.fully_traceable (sql/086/098) -
 * NO_PART_USED nunca es "pendiente de resolver".
 */
export function isFullyTraceableReport(lineStatuses: readonly HistoricalPartMatchStatus[]): boolean {
  if (lineStatuses.length === 0) return false;
  const traceable: ReadonlySet<HistoricalPartMatchStatus> = new Set([
    "CURRENT_DIRECT_MATCH",
    "HISTORICAL_ALIAS_MATCH",
    "DESCRIPTION_CONFIDENT_MATCH",
    "NO_PART_USED"
  ]);
  return lineStatuses.every(status => traceable.has(status));
}
