// Mismo patrón de fold que src/normalizers/fieldbeat-normalizer.js#normalizeText
// (no exportado ahí, se replica acá -es una utilidad de 4 líneas, no amerita
// una dependencia cruzada entre carpetas de pipeline distintas).
// Rango Unicode de diacríticos combinantes (U+0300-U+036F), construido por
// código de punto explícito (String.fromCharCode) para no depender de que
// el archivo fuente preserve caracteres combinantes literales embebidos en
// un regex -mismo rango que src/normalizers/fieldbeat-normalizer.js#normalizeText.
const DIACRITICS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function foldForComparison(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fábrica con estado propio de una sola corrida de importación (nunca
 * compartido entre corridas ni instanciado una sola vez a nivel de módulo).
 * Elige, para cada clave de comparación (tildes/mayúsculas/espacios
 * plegados), la PRIMERA grafía raw vista como "canónica" -las siguientes
 * filas que compartan esa clave pero difieran textualmente generan un
 * issue CLIENT_NAME_VARIANT (informativo: documenta la variante, no la
 * corrige a la fuerza -el raw de cada fila se conserva intacto).
 * @returns {{ normalize: (raw: string) => { clientNameRaw: string, clientNameCanonical: string, issues: Array<{issueType: string, details: object}> } }}
 */
export function createClientNameNormalizer() {
  /** @type {Map<string, string>} clave de comparación -> grafía canónica elegida */
  const canonicalByKey = new Map();
  /** @type {Map<string, Set<string>>} clave de comparación -> todas las grafías raw vistas */
  const variantsByKey = new Map();

  function normalize(raw) {
    const clientNameRaw = String(raw ?? "").trim();
    const key = foldForComparison(clientNameRaw);

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
      issues
    };
  }

  return { normalize };
}
