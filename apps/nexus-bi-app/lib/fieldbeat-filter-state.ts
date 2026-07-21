import type { FieldbeatOrigen } from "./fieldbeat-filters";

// Estado de filtros de UI de /dashboard/fieldbeat (ETAPA 6) - mismo
// criterio que lib/after-hours-filter-state.ts: TypeScript puro, sin
// React, testeable con node --test. buildQuickRanges/activeQuickRangeKey
// se REUTILIZAN de ese archivo (genéricos, solo dependen de from/to) -
// nunca se duplican acá.
export interface FieldbeatFilterState {
  from?: string;
  to?: string;
  cliente?: string;
  equipo?: string;
  tipoTarea?: string;
  origen?: FieldbeatOrigen;
  conTicket?: boolean;
  conRepuesto?: boolean;
}

export const EMPTY_FILTERS: FieldbeatFilterState = {};

export interface FilterChip {
  id: string;
  label: string;
}

export function buildFilterChips(filters: FieldbeatFilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.cliente) chips.push({ id: "cliente", label: `Cliente: ${filters.cliente}` });
  if (filters.equipo) chips.push({ id: "equipo", label: `Equipo: ${filters.equipo}` });
  if (filters.tipoTarea) chips.push({ id: "tipoTarea", label: `Tipo de tarea: ${filters.tipoTarea}` });
  if (filters.origen) chips.push({ id: "origen", label: `Origen: ${filters.origen}` });
  if (filters.conTicket !== undefined) chips.push({ id: "conTicket", label: filters.conTicket ? "Con ticket asociado" : "Sin ticket asociado" });
  if (filters.conRepuesto !== undefined) chips.push({ id: "conRepuesto", label: filters.conRepuesto ? "Con repuesto registrado" : "Sin repuesto registrado" });
  return chips;
}
