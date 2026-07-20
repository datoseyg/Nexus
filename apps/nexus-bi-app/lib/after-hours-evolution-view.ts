// Selector de métrica del gráfico de evolución temporal (ETAPA 6.6D §4.2)
// - una sola serie visible a la vez (nunca ejes duales ni magnitudes
// mezcladas, mismo criterio "un hue por vista" que ya sigue el resto de la
// app). `by-period` ya expone las 4 métricas requeridas en su respuesta
// real (AfterHoursByDimensionRow, vía groupedAggregateSelectSql/
// mapGroupedRow compartidos) - este módulo solo decide qué campo leer,
// nunca deriva una métrica nueva ni recalcula nada.
import { formatHours, formatInt } from "./after-hours-kpi-view";
import type { AfterHoursByDimensionRow } from "../types/after-hours";

export type EvolutionMetricKey = "after_hours_hours" | "total_tasks" | "after_hours_tasks" | "rate";

export interface EvolutionMetricDef {
  key: EvolutionMetricKey;
  label: string; // texto del botón del selector
  unit: string; // "h" | "tareas" | "%"
  getValue(row: AfterHoursByDimensionRow): number;
  formatValue(value: number): string;
}

function formatRatePercent(rate: number): string {
  return `${(rate * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
}

export const EVOLUTION_METRICS: readonly EvolutionMetricDef[] = [
  {
    key: "after_hours_hours",
    label: "Horas fuera de horario",
    unit: "h",
    getValue: row => row.after_hours_total_hours,
    formatValue: formatHours
  },
  {
    key: "total_tasks",
    label: "Tareas totales",
    unit: "tareas",
    getValue: row => row.total_tasks,
    formatValue: formatInt
  },
  {
    key: "after_hours_tasks",
    label: "Tareas fuera de horario",
    unit: "tareas",
    getValue: row => row.tasks_with_after_hours,
    formatValue: formatInt
  },
  {
    key: "rate",
    label: "Tasa fuera de horario",
    unit: "%",
    getValue: row => row.after_hours_rate,
    formatValue: formatRatePercent
  }
];

export function getEvolutionMetric(key: EvolutionMetricKey): EvolutionMetricDef {
  const found = EVOLUTION_METRICS.find(m => m.key === key);
  if (!found) throw new Error(`Métrica de evolución desconocida: ${key}`);
  return found;
}
