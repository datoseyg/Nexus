// Sección 1 del encargo NEXUS V3 - persistencia del rango Desde/Hasta de
// /dashboard/after-hours en la URL. Alcance deliberadamente acotado al
// RANGO (from/to) - el resto de los filtros (cliente/técnico/tipo de
// tarea/...) sigue siendo estado de sesión, sin URL, como ya era antes de
// este cambio; no se pidió persistir esos también.
export interface AfterHoursDateRange {
  from?: string;
  to?: string;
}

export function readAfterHoursDateRangeFromUrl(searchParams: URLSearchParams): AfterHoursDateRange {
  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined
  };
}

export function buildAfterHoursUrlQuery(range: AfterHoursDateRange): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  return params.toString();
}
