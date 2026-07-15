/**
 * Normalización de serial para comparación/matching -mayúsculas, espacios
 * colapsados, sin trim destructivo del valor real (ej. "FT02211" se
 * mantiene tal cual, no se le quita el prefijo). Nunca se usa para mostrar
 * el serial al usuario -eso siempre es el raw.
 * @param {string | null | undefined} rawSerial
 * @returns {string | null}
 */
export function normalizeSerialForMatching(rawSerial) {
  const value = String(rawSerial ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return value === "" ? null : value;
}

/**
 * Extrae el sufijo numérico final de un internal_id de FieldBeat, ej.
 * "Linac-153935" -> "153935". Devuelve null si no hay un sufijo numérico
 * claro (ej. "APOTECA-CHEMO").
 * @param {string | null | undefined} internalId
 * @returns {string | null}
 */
export function extractTrailingSerial(internalId) {
  const value = String(internalId ?? "").trim();
  const match = value.match(/(\d{3,})\s*$/);
  return match ? match[1] : null;
}
