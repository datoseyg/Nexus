"use client";

import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { AfterHoursBarRow } from "./AfterHoursBarRow";
import { maxOf } from "@/lib/after-hours-bar-list-view";
import { formatHours } from "@/lib/after-hours-kpi-view";
import { getWeekdayLabel } from "@/lib/after-hours-labels";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

interface AfterHoursWeekdayChartProps {
  rows: AfterHoursByDimensionRow[]; // siempre 7, orden fijo lunes->domingo (padWeekdayRows)
  status?: "idle" | "loading" | "refreshing" | "success" | "empty" | "error";
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (row: AfterHoursByDimensionRow) => void;
  selectedWeekday?: number | null;
}

// "¿Qué días concentran más actividad?" - distribución por día de la
// semana (ETAPA 6.6D, antes placeholder AfterHoursNotYetAvailable).
// Reutiliza AfterHoursBarRow, pero a diferencia de los rankings NUNCA
// reordena por valor - el orden que llega en `rows` (lunes->domingo,
// garantizado por padWeekdayRows en el backend) es el que se renderiza tal
// cual, siempre.
export function AfterHoursWeekdayChart({ rows, status = "success", error, onRetry, onSelect, selectedWeekday }: AfterHoursWeekdayChartProps) {
  const hasData = rows.some(r => r.total_tasks > 0);
  const max = maxOf(rows.map(r => r.after_hours_total_hours));

  return (
    <AfterHoursSectionCard question="¿Qué días concentran más actividad?" subtitle="Distribución por día de la semana">
      {status === "error" ? (
        <AfterHoursEmptyBlock layout="column" tone="error" title="No se pudo cargar esta sección" description={error ?? "Intenta nuevamente en unos minutos."} onRetry={onRetry} />
      ) : status === "loading" ? (
        <div className="space-y-2" aria-live="polite" aria-busy="true">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-4 rounded" style={{ background: "var(--nx-page-bg)" }} />
          ))}
        </div>
      ) : !hasData ? (
        <AfterHoursEmptyBlock layout="column" title="Sin actividad en el rango filtrado" description="Ningún día tiene tareas para los filtros actuales." />
      ) : (
        <div className="space-y-1" style={status === "refreshing" ? { opacity: 0.6 } : undefined} aria-busy={status === "refreshing"}>
          {status === "refreshing" && (
            <div className="mb-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
              Actualizando…
            </div>
          )}
          {rows.map(row => {
            const iso = Number(row.key);
            return (
              <AfterHoursBarRow
                key={row.key}
                label={getWeekdayLabel(iso)}
                ariaLabel={`${getWeekdayLabel(iso)}, ${formatHours(row.after_hours_total_hours)} fuera de horario, ${row.total_tasks} tareas`}
                value={row.after_hours_total_hours}
                maxValue={max}
                valueLabel={formatHours(row.after_hours_total_hours)}
                selected={selectedWeekday === iso}
                onClick={onSelect ? () => onSelect(row) : undefined}
              />
            );
          })}
        </div>
      )}
    </AfterHoursSectionCard>
  );
}
