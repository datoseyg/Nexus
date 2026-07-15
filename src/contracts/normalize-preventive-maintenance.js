const SCALAR_PATTERN = /^\d+$/;
const RANGE_PATTERN = /^(\d+)\s*-\s*(\d+)$/;

/**
 * Q Mant Prev x Año -> {min, max, rule, issues}. Nunca inventa un número
 * para reglas textuales ("Por cada cambio fuente" queda como regla, sin
 * min/max numérico).
 * @param {string} raw
 * @returns {{ min: number | null, max: number | null, rule: string | null, issues: Array<{issueType: string, details: object}> }}
 */
export function parsePreventiveMaintenance(raw) {
  const value = String(raw ?? "").trim();

  if (value === "" || value === "-") {
    return { min: null, max: null, rule: null, issues: [] };
  }

  if (SCALAR_PATTERN.test(value)) {
    const n = Number(value);
    return { min: n, max: n, rule: null, issues: [] };
  }

  const rangeMatch = value.match(RANGE_PATTERN);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    return { min, max, rule: null, issues: [] };
  }

  // Regla textual (ej. "Por cada cambio fuente") -no numérica, se conserva
  // como texto, nunca se inventa un min/max.
  return {
    min: null,
    max: null,
    rule: value,
    issues: [{ issueType: "NON_SCALAR_PREVENTIVE_QUOTA", details: { raw: value } }]
  };
}
