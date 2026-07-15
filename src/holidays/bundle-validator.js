import { deriveSourceEventKey } from "./source-event-key.js";

export const SCHEMA_VERSION = "holiday-calendar-bundle-v1";

// Debe coincidir 1:1 con el CHECK de config.holiday_calendar_entries tras
// sql/083_holiday_calendar_import_support.sql -ver test de no-drift.
export const HOLIDAY_TYPES = Object.freeze(["FIXED_DATE", "MOVABLE", "REGIONAL", "ELECTION", "ONE_OFF"]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(s) {
  return typeof s === "string" && DATE_PATTERN.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

/**
 * Valida la forma de un bundle anual, sin tocar ninguna base de datos.
 * @param {object} bundle parseado (ver bundle-source.js)
 * @returns {{ ok: boolean, errors: string[], warnings: string[], resolvedEvents: object[] }}
 */
export function validateBundle(bundle) {
  const errors = [];
  const warnings = [];

  if (!bundle || typeof bundle !== "object") {
    return { ok: false, errors: ["El bundle no es un objeto JSON."], warnings: [], resolvedEvents: [] };
  }

  if (bundle.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version debe ser "${SCHEMA_VERSION}", recibido "${bundle.schema_version}".`);
  }

  if (!bundle.jurisdiction || typeof bundle.jurisdiction !== "string") {
    errors.push("jurisdiction es obligatoria y debe ser un string no vacío.");
  }

  if (!isValidDateString(bundle.coverage_start)) {
    errors.push(`coverage_start inválido: "${bundle.coverage_start}" (formato esperado YYYY-MM-DD).`);
  }
  if (!isValidDateString(bundle.coverage_end_exclusive)) {
    errors.push(`coverage_end_exclusive inválido: "${bundle.coverage_end_exclusive}" (formato esperado YYYY-MM-DD).`);
  }
  if (isValidDateString(bundle.coverage_start) && isValidDateString(bundle.coverage_end_exclusive)) {
    if (bundle.coverage_start >= bundle.coverage_end_exclusive) {
      errors.push(`Rango de cobertura inválido: coverage_start (${bundle.coverage_start}) debe ser anterior a coverage_end_exclusive (${bundle.coverage_end_exclusive}).`);
    } else {
      // Cobertura anual completa esperada (§9) -no bloqueante, solo informativo.
      const start = new Date(`${bundle.coverage_start}T00:00:00Z`);
      const end = new Date(`${bundle.coverage_end_exclusive}T00:00:00Z`);
      const oneYearLater = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
      if (end.getTime() !== oneYearLater.getTime()) {
        warnings.push(`El rango de cobertura no equivale a exactamente 1 año calendario desde coverage_start (${bundle.coverage_start} -> ${bundle.coverage_end_exclusive}).`);
      }
    }
  }

  const sources = Array.isArray(bundle.sources) ? bundle.sources : [];
  if (!Array.isArray(bundle.sources) || bundle.sources.length === 0) {
    errors.push("sources debe ser un array con al menos 1 fuente.");
  }
  const sourceIds = new Set();
  for (const [i, s] of sources.entries()) {
    if (!s.source_id) errors.push(`sources[${i}].source_id es obligatorio.`);
    else sourceIds.add(s.source_id);
    if (!s.authority) errors.push(`sources[${i}].authority es obligatorio.`);
    if (!s.title) errors.push(`sources[${i}].title es obligatorio.`);
    if (!s.url) errors.push(`sources[${i}].url es obligatorio.`);
    if (!s.accessed_at || !isValidDateString(s.accessed_at)) errors.push(`sources[${i}].accessed_at debe ser una fecha YYYY-MM-DD válida.`);
    if (s.published_at && !isValidDateString(s.published_at)) errors.push(`sources[${i}].published_at, si existe, debe ser YYYY-MM-DD válida.`);
  }

  const events = Array.isArray(bundle.events) ? bundle.events : [];
  if (!Array.isArray(bundle.events)) errors.push("events debe ser un array.");

  const resolvedEvents = [];
  const seenKeys = new Set();
  let previousDate = null;
  let outOfOrder = false;

  for (const [i, e] of events.entries()) {
    if (!isValidDateString(e.local_date)) {
      errors.push(`events[${i}].local_date inválido: "${e.local_date}".`);
      continue;
    }
    if (isValidDateString(bundle.coverage_start) && isValidDateString(bundle.coverage_end_exclusive)) {
      if (e.local_date < bundle.coverage_start || e.local_date >= bundle.coverage_end_exclusive) {
        errors.push(`events[${i}] (${e.local_date}) cae fuera del rango de cobertura [${bundle.coverage_start}, ${bundle.coverage_end_exclusive}).`);
      }
    }
    if (!e.holiday_name || typeof e.holiday_name !== "string") {
      errors.push(`events[${i}].holiday_name es obligatorio.`);
    }
    if (!HOLIDAY_TYPES.includes(e.holiday_type)) {
      errors.push(`events[${i}].holiday_type "${e.holiday_type}" no es una categoría representable (${HOLIDAY_TYPES.join(", ")}).`);
      continue;
    }
    if (e.is_irrenunciable !== undefined && e.is_irrenunciable !== null && typeof e.is_irrenunciable !== "boolean") {
      errors.push(`events[${i}].is_irrenunciable debe ser boolean si está presente, recibido ${typeof e.is_irrenunciable}.`);
    }
    const eventSourceIds = Array.isArray(e.source_ids) ? e.source_ids : [];
    if (eventSourceIds.length === 0) {
      errors.push(`events[${i}] (${e.holiday_name}) no referencia ninguna fuente (source_ids vacío).`);
    }
    for (const sid of eventSourceIds) {
      if (!sourceIds.has(sid)) {
        errors.push(`events[${i}] referencia source_id "${sid}" que no existe en sources[].`);
      }
    }

    const resolvedKey = deriveSourceEventKey({
      jurisdiction: bundle.jurisdiction,
      localDate: e.local_date,
      holidayType: e.holiday_type,
      holidayName: e.holiday_name,
      explicitId: e.source_event_key || null
    });
    if (e.source_event_key && e.source_event_key !== resolvedKey) {
      // La fuente trae un ID propio explícito -se respeta tal cual (no se
      // exige que "coincida" con la derivación determinística, esa
      // derivación es solo el fallback cuando no hay ID explícito).
    }
    const finalKey = e.source_event_key || resolvedKey;
    if (seenKeys.has(finalKey)) {
      errors.push(`Evento duplicado exacto: source_event_key "${finalKey}" ya fue usado por otro evento en este bundle.`);
    }
    seenKeys.add(finalKey);

    if (previousDate !== null && e.local_date < previousDate) outOfOrder = true;
    previousDate = e.local_date;

    resolvedEvents.push({ ...e, source_event_key: finalKey });
  }

  if (outOfOrder) {
    warnings.push("Los eventos no están ordenados ascendentemente por local_date (no bloqueante).");
  }

  return { ok: errors.length === 0, errors, warnings, resolvedEvents };
}
