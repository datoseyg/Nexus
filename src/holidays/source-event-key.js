// Identidad determinística de un evento feriado (nunca UUID aleatorio -ver
// sql/080_holiday_calendar.sql, UNIQUE(source_import_id, source_event_key)).
// Cuando la fuente trae un identificador propio, se usa tal cual. Cuando no,
// se deriva de jurisdiction + local_date + holiday_type + nombre
// normalizado -mismo nombre siempre produce la misma clave.

/**
 * Normalización mínima especificada: NFD, sin marcas diacríticas,
 * minúsculas, trim, colapsar espacios, espacios->guiones, eliminar
 * caracteres no permitidos (solo [a-z0-9-] sobrevive).
 * @param {string} text
 * @returns {string}
 */
export function normalizeForKey(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * @param {{ jurisdiction: string, localDate: string, holidayType: string, holidayName: string, explicitId?: string|null }} params
 * @returns {string}
 */
export function deriveSourceEventKey({ jurisdiction, localDate, holidayType, holidayName, explicitId }) {
  if (explicitId) return explicitId;
  const slug = normalizeForKey(holidayName);
  return `${jurisdiction}:${localDate}:${holidayType}:${slug}`;
}
