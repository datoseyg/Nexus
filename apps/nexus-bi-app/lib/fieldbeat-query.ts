import type { FieldbeatFilterState } from "./fieldbeat-filter-state";

// Mismo criterio que lib/after-hours-query.ts: serialización de query
// PURA y compartida por /activity y /detail - un fix acá cubre ambas
// rutas por construcción, nunca una copia divergente por endpoint.
export function buildFieldbeatQuery(filters: FieldbeatFilterState, extra: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  const entries: Record<string, string | undefined> = {
    cliente: filters.cliente,
    equipo: filters.equipo,
    tipoTarea: filters.tipoTarea,
    origen: filters.origen,
    from: filters.from,
    to: filters.to,
    conTicket: filters.conTicket !== undefined ? String(filters.conTicket) : undefined,
    conRepuesto: filters.conRepuesto !== undefined ? String(filters.conRepuesto) : undefined
  };
  for (const [key, value] of Object.entries(entries)) if (value) search.set(key, value);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
}
