import type { AfterHoursByDimensionRow } from "@/types/after-hours";

// ETAPA 6.6D-FIX-1 - deriva las opciones del <select> de técnico/cliente
// desde las filas YA filtradas (fecha + demás filtros, autoexcluyendo solo
// su propia dimensión) de by-technician/by-client, en vez del catálogo
// global filterOptions.tecnicos/clientes (que ignora el filtro de fecha a
// propósito - ver summary/route.ts). Se ordena alfabéticamente por `key`
// (mismo orden que el ORDER BY v del catálogo global que reemplaza) - el
// ranking en sí (AfterHoursRankingCard) sigue ordenado por valor, esto es
// solo para la lista del dropdown.
export function optionKeysAsc(rows: AfterHoursByDimensionRow[] | null | undefined): string[] {
  if (!rows) return [];
  return [...rows].map(r => r.key).sort((a, b) => a.localeCompare(b));
}
