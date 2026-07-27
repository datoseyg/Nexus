import { getDataBasisLabel, getReasonCodeLabel, getWeekdayLabel } from "./after-hours-labels";
import type { AfterHoursDataBasis } from "@/types/after-hours";

// Estado de filtros de UI de /dashboard/after-hours (ETAPA 6.6D §7) -
// extraído a lib/ (en vez de vivir solo dentro de AfterHoursFilters.tsx)
// para quedar testeable con node --test sin requerir un transformador de
// JSX: este módulo es TypeScript puro, sin React.
export interface AfterHoursFilterState {
  from?: string;
  to?: string;
  client?: string;
  technician?: string;
  taskType?: string;
  dataBasis?: AfterHoursDataBasis;
  confidenceLevel?: string;
  onlyAfterHours?: boolean;
  onlyLowConfidence?: boolean;
  fallbackUsed?: boolean;
  coverageReasonCode?: string;
  contractualReasonCode?: string;
  // Aditivos ETAPA 6.6D: weekday se setea desde el gráfico de día de la
  // semana (solo) o junto con hour desde una celda del heatmap día×hora.
  // hour NUNCA se setea de forma independiente - no existe un control de
  // "Hora" aislado (ver AfterHoursFilters.tsx), por eso buildFilterChips()
  // los funde en un único chip compuesto solo cuando ambos están
  // presentes, a diferencia de technician/client (que sí se configuran de
  // forma independiente entre sí y por lo tanto NUNCA se fusionan).
  weekday?: number;
  hour?: number;
}

export const EMPTY_FILTERS: AfterHoursFilterState = {};

export interface QuickRange {
  key: string;
  label: string;
  from?: string;
  to?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Rangos rápidos (§7) - nombres del encargo, no los del prototipo (Hoy/7
// días/30 días son placeholders de demo); calculados sobre fechas reales
// relativas a `now`, nunca strings fijos como "01 ene 2026 - 31 dic 2026".
// `now` es inyectable para que los tests sean deterministas sin depender
// del reloj del sistema.
export function buildQuickRanges(now: Date = new Date()): QuickRange[] {
  const today = isoDate(now);
  const year = now.getUTCFullYear();

  const startOfMonth = new Date(Date.UTC(year, now.getUTCMonth(), 1));
  const months3 = new Date(now);
  months3.setUTCMonth(months3.getUTCMonth() - 3);
  const months6 = new Date(now);
  months6.setUTCMonth(months6.getUTCMonth() - 6);
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const prevYearStart = new Date(Date.UTC(year - 1, 0, 1));
  const prevYearEnd = new Date(Date.UTC(year - 1, 11, 31));

  return [
    { key: "all", label: "Todo" },
    { key: "month", label: "Este mes", from: isoDate(startOfMonth), to: today },
    { key: "3m", label: "Últimos 3 meses", from: isoDate(months3), to: today },
    { key: "6m", label: "Últimos 6 meses", from: isoDate(months6), to: today },
    { key: "year", label: "Este año", from: isoDate(startOfYear), to: today },
    { key: "prevYear", label: "Año anterior", from: isoDate(prevYearStart), to: isoDate(prevYearEnd) }
  ];
}

export interface FilterChip {
  id: string;
  label: string;
}

// Chips de "Filtros aplicados" (§7) - un chip por campo activo, cada uno
// independientemente removible en la UI (el onRemove real vive en el
// componente, acá solo se decide QUÉ chips existen y con qué texto).
export function buildFilterChips(filters: AfterHoursFilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.client) chips.push({ id: "client", label: `Cliente: ${filters.client}` });
  // HOTFIX auditoría After-Hours (§5): "responsable" deja explícito que el
  // filtro acota por assigned_to, nunca por participantes adicionales.
  if (filters.technician) chips.push({ id: "technician", label: `Técnico responsable: ${filters.technician}` });
  if (filters.taskType) chips.push({ id: "taskType", label: `Tipo de tarea: ${filters.taskType}` });
  if (filters.dataBasis) chips.push({ id: "dataBasis", label: `Base de cálculo: ${getDataBasisLabel(filters.dataBasis).label}` });
  if (filters.confidenceLevel) chips.push({ id: "confidenceLevel", label: `Confianza: ${filters.confidenceLevel}` });
  if (filters.onlyAfterHours) chips.push({ id: "onlyAfterHours", label: "Solo fuera de horario" });
  if (filters.onlyLowConfidence) chips.push({ id: "onlyLowConfidence", label: "Solo baja confianza" });
  if (filters.fallbackUsed) chips.push({ id: "fallbackUsed", label: "Solo con fallback" });
  if (filters.coverageReasonCode) chips.push({ id: "coverageReasonCode", label: `Motivo final: ${getReasonCodeLabel(filters.coverageReasonCode).shortLabel}` });
  if (filters.contractualReasonCode)
    chips.push({ id: "contractualReasonCode", label: `Motivo contractual: ${getReasonCodeLabel(filters.contractualReasonCode).shortLabel}` });

  // weekday+hour (seleccionados juntos desde una celda del heatmap) son UN
  // SOLO chip compuesto - a diferencia de technician/client (que se
  // configuran también de forma independiente y por eso siguen siendo dos
  // chips separados), hour nunca existe sin weekday en esta UI. `hour`
  // siempre se compara con `!== undefined` (nunca truthy): 0 = medianoche
  // es un valor válido que una comprobación truthy descartaría.
  if (filters.weekday && filters.hour !== undefined) {
    chips.push({ id: "weekdayHour", label: `Día y hora: ${getWeekdayLabel(filters.weekday)}, ${String(filters.hour).padStart(2, "0")}:00` });
  } else if (filters.weekday) {
    chips.push({ id: "weekday", label: `Día: ${getWeekdayLabel(filters.weekday)}` });
  }

  return chips;
}

// Determina qué rango rápido (si alguno) coincide con el filtro from/to
// actual - usado para resaltar el botón activo. `null` significa "rango
// custom, ninguno de los presets calza"; distinto de "all" (sin from/to).
export function activeQuickRangeKey(ranges: QuickRange[], filters: Pick<AfterHoursFilterState, "from" | "to">): string | null {
  const match = ranges.find(r => r.from === filters.from && r.to === filters.to);
  if (match) return match.key;
  return filters.from || filters.to ? null : "all";
}
