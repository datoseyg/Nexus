import type { AfterHoursFilterState } from "./after-hours-filter-state";

// ETAPA 6.6D-FIX-1 - extraído de AfterHoursShell.tsx (vivía como función
// privada del componente, no testeable con node --test sin jsdom) para que
// la serialización de query compartida por TODAS las secciones (summary,
// by-technician, by-client, ...) sea una función pura verificable: al
// consumir el mismo string de query, un fix en dateFrom/dateTo acá cubre
// las tres rutas a la vez, por construcción (no hay una copia divergente
// por endpoint).
export function buildAfterHoursQuery(filters: AfterHoursFilterState, extra: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  const entries: Record<string, string | undefined> = {
    client: filters.client,
    technician: filters.technician,
    taskType: filters.taskType,
    from: filters.from,
    to: filters.to,
    dataBasis: filters.dataBasis,
    confidenceLevel: filters.confidenceLevel,
    onlyAfterHours: filters.onlyAfterHours ? "true" : undefined,
    onlyLowConfidence: filters.onlyLowConfidence ? "true" : undefined,
    fallbackUsed: filters.fallbackUsed ? "true" : undefined,
    coverageReasonCode: filters.coverageReasonCode,
    contractualReasonCode: filters.contractualReasonCode,
    weekday: filters.weekday !== undefined ? String(filters.weekday) : undefined,
    // hour !== undefined, NUNCA truthy - hour=0 (medianoche) es válido.
    hour: filters.hour !== undefined ? String(filters.hour) : undefined
  };
  for (const [key, value] of Object.entries(entries)) if (value) search.set(key, value);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
}
