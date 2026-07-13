// Normalización pura de la consulta de Búsqueda global (ETAPA 8) - CERO
// imports de pg/next/server/SQL/módulos exclusivos de Node, para poder
// importarse tanto desde lib/search-filters.ts (backend) como desde
// components/search/search.utils.ts (frontend, "use client") sin arrastrar
// nada del lado servidor. Toda la lógica de recorte de caracteres, descarte
// de tokens cortos, límite de tokens y construcción de la "consulta
// efectiva" vive acá, una sola vez - no se duplica a mano en ningún otro
// archivo.

export const MAX_QUERY_LENGTH = 200;
export const MAX_SEARCH_TOKENS = 6;
export const MIN_TOKEN_LENGTH = 2;

export type QueryAdjustmentReason = "length" | "tokenCount" | "shortTokens";

export interface NormalizedSearchQuery {
  /** Consulta efectiva: los tokens que realmente participan en SQL, unidos por espacio. */
  effectiveQuery: string;
  /** Tokens válidos (>=2 caracteres), ya acotados a MAX_SEARCH_TOKENS. */
  tokens: string[];
  /** true si effectiveQuery difiere de la consulta cruda en algún sentido (recorte, tokens cortos descartados, límite de tokens). */
  queryAdjusted: boolean;
  /** Motivos concretos del ajuste, en el orden en que se detectaron. Vacío si queryAdjusted es false. */
  queryAdjustmentReasons: QueryAdjustmentReason[];
}

const ADJUSTMENT_MESSAGES: Record<QueryAdjustmentReason, string> = {
  length: "La consulta fue recortada al límite admitido.",
  tokenCount: "Se utilizaron los primeros 6 términos válidos.",
  shortTokens: "Se ignoraron términos de menos de 2 caracteres."
};

const MULTI_REASON_MESSAGE = "La consulta fue ajustada a los términos válidos admitidos.";

/**
 * Normaliza una consulta cruda de búsqueda: recorta a MAX_QUERY_LENGTH
 * caracteres, tokeniza por espacios, descarta tokens de menos de
 * MIN_TOKEN_LENGTH caracteres, y limita a MAX_SEARCH_TOKENS tokens.
 * `effectiveQuery` es exactamente lo que participa en las condiciones SQL -
 * nunca se le muestra al usuario un texto de búsqueda que no haya sido
 * realmente aplicado.
 */
export function normalizeSearchQuery(rawQuery: string): NormalizedSearchQuery {
  const reasons: QueryAdjustmentReason[] = [];

  const trimmedRaw = rawQuery.trim();
  const lengthClamped = trimmedRaw.length > MAX_QUERY_LENGTH ? trimmedRaw.slice(0, MAX_QUERY_LENGTH) : trimmedRaw;
  if (lengthClamped.length !== trimmedRaw.length) reasons.push("length");

  const allRawTokens = lengthClamped.split(/\s+/).filter(Boolean);
  const validLengthTokens = allRawTokens.filter(token => token.length >= MIN_TOKEN_LENGTH);
  if (validLengthTokens.length !== allRawTokens.length) reasons.push("shortTokens");

  const tokens = validLengthTokens.slice(0, MAX_SEARCH_TOKENS);
  if (validLengthTokens.length > MAX_SEARCH_TOKENS) reasons.push("tokenCount");

  return {
    effectiveQuery: tokens.join(" "),
    tokens,
    queryAdjusted: reasons.length > 0,
    queryAdjustmentReasons: reasons
  };
}

/** Copy exacto a mostrar en la UI según los motivos de ajuste detectados. */
export function resolveQueryAdjustmentMessage(reasons: QueryAdjustmentReason[]): string | null {
  if (reasons.length === 0) return null;
  if (reasons.length > 1) return MULTI_REASON_MESSAGE;
  return ADJUSTMENT_MESSAGES[reasons[0]];
}
