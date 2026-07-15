/**
 * Fábrica genérica raw -> código controlado. Cualquier valor raw no
 * mapeado cae a `fallbackCode` (siempre 'UNKNOWN' en este proyecto) y
 * genera un issue -nunca se adivina un código para un valor no visto.
 * @param {{map: Record<string, string>, fallbackCode: string, issueType: string}} config
 * @returns {(raw: string) => { code: string, raw: string | null, issues: Array<{issueType: string, details: object}> }}
 */
export function createLookupNormalizer({ map, fallbackCode, issueType }) {
  return function normalize(raw) {
    const value = String(raw ?? "").trim();

    if (value === "") {
      return { code: fallbackCode, raw: null, issues: [] };
    }

    const code = map[value];
    if (code) {
      return { code, raw: value, issues: [] };
    }

    return {
      code: fallbackCode,
      raw: value,
      issues: [{ issueType, details: { raw: value } }]
    };
  };
}
