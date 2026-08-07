// Única implementación (Bloque 2 NEXUS V3) vive dentro de apps/nexus-bi-app/
// (ver comentario extenso en ese archivo: Turbopack no puede incluir un
// archivo fuera de su root pineado en un bundle de cliente, así que el
// pipeline -sin esa restricción- es quien alcanza hacia adentro, nunca al
// revés).
import { buildContractClientNameKey } from "../../apps/nexus-bi-app/lib/contract-client-name-key.js";

/**
 * Fábrica con estado propio de una sola corrida de importación (nunca
 * compartido entre corridas ni instanciado una sola vez a nivel de módulo).
 * Elige, para cada clave de comparación (tildes/mayúsculas/espacios
 * plegados), la PRIMERA grafía raw vista como "canónica" -las siguientes
 * filas que compartan esa clave pero difieran textualmente generan un
 * issue CLIENT_NAME_VARIANT (informativo: documenta la variante, no la
 * corrige a la fuerza -el raw de cada fila se conserva intacto).
 * @returns {{ normalize: (raw: string) => { clientNameRaw: string, clientNameCanonical: string, clientNameKey: string, issues: Array<{issueType: string, details: object}> } }}
 */
export function createClientNameNormalizer() {
  /** @type {Map<string, string>} clave de comparación -> grafía canónica elegida */
  const canonicalByKey = new Map();
  /** @type {Map<string, Set<string>>} clave de comparación -> todas las grafías raw vistas */
  const variantsByKey = new Map();

  function normalize(raw) {
    const clientNameRaw = String(raw ?? "").trim();
    const key = buildContractClientNameKey(clientNameRaw);

    const issues = [];

    if (!canonicalByKey.has(key)) {
      canonicalByKey.set(key, clientNameRaw);
      variantsByKey.set(key, new Set([clientNameRaw]));
    } else {
      const variants = variantsByKey.get(key);
      if (!variants.has(clientNameRaw)) {
        variants.add(clientNameRaw);
        issues.push({
          issueType: "CLIENT_NAME_VARIANT",
          details: { canonical: canonicalByKey.get(key), variant: clientNameRaw }
        });
      }
    }

    return {
      clientNameRaw,
      clientNameCanonical: canonicalByKey.get(key),
      clientNameKey: key,
      issues
    };
  }

  return { normalize };
}
