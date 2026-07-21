"use client";

import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { AfterHoursBarRow } from "./AfterHoursBarRow";
import { maxOf } from "@/lib/after-hours-bar-list-view";
import { formatHours } from "@/lib/after-hours-kpi-view";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

interface AfterHoursRankingCardProps {
  question: string;
  subtitle: string;
  rows: AfterHoursByDimensionRow[];
  limit?: number;
  status?: "idle" | "loading" | "refreshing" | "success" | "empty" | "error";
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (row: AfterHoursByDimensionRow) => void;
  selectedKey?: string | null;
}

// Ranking de una sola serie (magnitud, no identidad) - técnicos, clientes o
// tipo de tarea (ETAPA 6.6D §9), conectados a by-technician/by-client/
// by-task-type. Mismo componente para los 3 (misma forma de fila:
// key + after_hours_total_hours).
//
// ETAPA 6.6D: barras accesibles (AfterHoursBarRow) en vez de Recharts -
// cada fila es un <button> real con foco de teclado y aria-label, permite
// click-to-filter (onSelect) con estado visual de selección
// (selectedKey), y maneja su propio estado de carga/error/reintento en
// vez de depender de un Promise.all/allSettled compartido en el padre.
export function AfterHoursRankingCard({
  question,
  subtitle,
  rows,
  limit = 10,
  status = "success",
  error,
  onRetry,
  onSelect,
  selectedKey
}: AfterHoursRankingCardProps) {
  const data = rows.slice(0, limit);
  const hasData = data.length > 0;
  const max = maxOf(data.map(r => r.after_hours_total_hours));

  return (
    <AfterHoursSectionCard question={question} subtitle={subtitle}>
      {status === "error" ? (
        <AfterHoursEmptyBlock layout="column" tone="error" title="No se pudo cargar esta sección" description={error ?? "Intenta nuevamente en unos minutos."} onRetry={onRetry} />
      ) : status === "loading" ? (
        <div className="space-y-2" aria-live="polite" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 rounded" style={{ background: "var(--nx-page-bg)" }} />
          ))}
        </div>
      ) : !hasData ? (
        <AfterHoursEmptyBlock layout="column" title="Información todavía no disponible" />
      ) : (
        <div
          className="space-y-1"
          style={status === "refreshing" ? { opacity: 0.6 } : undefined}
          aria-busy={status === "refreshing"}
        >
          {status === "refreshing" && (
            <div className="mb-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
              Actualizando…
            </div>
          )}
          {data.map(row => (
            <AfterHoursBarRow
              key={row.key}
              label={row.key}
              ariaLabel={`${row.key}, ${formatHours(row.after_hours_total_hours)} fuera de horario`}
              value={row.after_hours_total_hours}
              maxValue={max}
              valueLabel={formatHours(row.after_hours_total_hours)}
              selected={selectedKey === row.key}
              onClick={onSelect ? () => onSelect(row) : undefined}
            />
          ))}
        </div>
      )}
    </AfterHoursSectionCard>
  );
}
