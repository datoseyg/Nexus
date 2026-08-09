// Bloque 2 NEXUS V3 - migración de un valor de filtro `client` heredado en
// la URL de Contratos hacia la clave normalizada (client_name_key).
//
// lib/contract-client-name-key.js es la ÚNICA implementación física del
// algoritmo de folding, reutilizada sin cambios por el importador de
// contratos (src/contracts/normalize-client.js, fieldbeat-matcher.js) - ver
// el comentario extenso en ese archivo sobre por qué vive DENTRO de esta
// app (turbopack.root pineado, ver next.config.ts) en vez de en
// src/contracts/ junto al resto del dominio contractual: un import cruzado
// hacia afuera de esta app funciona en tsc/typecheck pero `next build` lo
// rechaza para bundles de cliente ("the chunking context does not support
// external modules"), confirmado con un build real - no es una suposición.
import { buildContractClientNameKey } from "@/lib/contract-client-name-key.js";
import type { ExplorerFilterOption } from "@/lib/explorer-filters-config";

export type LegacyContractClientFilterResolution =
  | { kind: "EXACT_MATCH"; value: string }
  | { kind: "MIGRATED"; value: string }
  | { kind: "UNRESOLVED" };

/**
 * Resuelve un valor de `client` presente en la URL contra las opciones
 * ACTUALES del facet `contractClients` (mismo fetch que ya llena el
 * `<select>`, sin request adicional):
 * 1. Coincidencia exacta con algún option.value (client_name_key) -caso
 *    normal, toda URL generada por la app a partir de este fix.
 * 2. Si no hay coincidencia exacta, se aplica folding al valor de la URL
 *    (buildContractClientNameKey) y se compara contra las claves actuales -
 *    cubre una URL heredada que llevaba una grafía en vez de la clave. Si
 *    coincide con EXACTAMENTE una opción, se considera resuelta (MIGRATED);
 *    ambigüedad (2+ coincidencias, no debería ocurrir con una clave real)
 *    se trata como no resuelta, nunca se elige una al azar.
 * 3. Si no coincide con ninguna, UNRESOLVED - el caller muestra "cliente no
 *    disponible" + acción de limpiar, nunca un panel de cero silencioso.
 *
 * Nunca reintenta esto en el backend -un valor heredado del vocabulario
 * VIEJO (FieldBeat, facet "clientes" previo al fix) no es una variante
 * ortográfica del vocabulario de contratos, es un vocabulario distinto;
 * aplicarle folding no lo reconciliaría de forma confiable.
 */
export function resolveLegacyContractClientFilter(
  urlValue: string,
  facetOptions: ExplorerFilterOption[]
): LegacyContractClientFilterResolution {
  if (facetOptions.some(option => option.value === urlValue)) {
    return { kind: "EXACT_MATCH", value: urlValue };
  }

  const foldedValue = buildContractClientNameKey(urlValue);
  const matches = facetOptions.filter(option => option.value === foldedValue);
  if (matches.length === 1) {
    return { kind: "MIGRATED", value: matches[0].value };
  }

  return { kind: "UNRESOLVED" };
}
