"use client";

import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { AfterHoursBarRow } from "./AfterHoursBarRow";
import { maxOf } from "@/lib/after-hours-bar-list-view";
import { formatHours, formatInt } from "@/lib/after-hours-kpi-view";
import type { AfterHoursByDimensionRow, AfterHoursTechnicianClientResponse } from "@/types/after-hours";

interface AfterHoursTechnicianClientCardProps {
  data: AfterHoursTechnicianClientResponse | null;
  status?: "idle" | "loading" | "refreshing" | "success" | "empty" | "error";
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (row: AfterHoursByDimensionRow) => void;
  selectedTechnician?: string | null;
  selectedClient?: string | null;
}

// "¿Cómo se relacionan técnicos y clientes?" - ranking de PARES
// técnico×cliente (ETAPA 6.6D, antes placeholder AfterHoursNotYetAvailable).
// Decisión de diseño: lista de pares rankeados (key compuesta
// "técnico · cliente"), no una matriz 2D - evita una grilla dispersa de
// hasta N técnicos x M clientes, difícil de leer y de accesibilizar.
// Reutiliza AfterHoursBarRow; el click aplica AMBOS filtros (técnico Y
// cliente) a la vez, como una selección compuesta.
export function AfterHoursTechnicianClientCard({
  data,
  status = "success",
  error,
  onRetry,
  onSelect,
  selectedTechnician,
  selectedClient
}: AfterHoursTechnicianClientCardProps) {
  const rows = data?.rows ?? [];
  const excludedTasks = data?.excludedTasks ?? 0;
  const hasRows = rows.length > 0;
  const max = maxOf(rows.map(r => r.after_hours_total_hours));

  return (
    <AfterHoursSectionCard question="¿Cómo se relacionan técnicos responsables y clientes?" subtitle="Actividad cruzada (responsable principal por tarea)">
      {status === "error" ? (
        <AfterHoursEmptyBlock layout="column" tone="error" title="No se pudo cargar esta sección" description={error ?? "Intenta nuevamente en unos minutos."} onRetry={onRetry} />
      ) : status === "loading" ? (
        <div className="space-y-2" aria-live="polite" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 rounded" style={{ background: "var(--nx-page-bg)" }} />
          ))}
        </div>
      ) : !hasRows && excludedTasks === 0 ? (
        <AfterHoursEmptyBlock layout="column" title="Información todavía no disponible" />
      ) : !hasRows && excludedTasks > 0 ? (
        // Estado parcial explicativo (nunca el vacío genérico): SÍ hay
        // tareas para los filtros actuales, pero ninguna tiene técnico Y
        // cliente identificables a la vez -distinto de "no hay datos".
        <AfterHoursEmptyBlock
          layout="column"
          title="Hay tareas, pero no poseen técnico y cliente identificables."
          description={`${formatInt(excludedTasks)} tarea(s) sin un par técnico-cliente completo para los filtros actuales.`}
        />
      ) : (
        <div className="space-y-1" style={status === "refreshing" ? { opacity: 0.6 } : undefined} aria-busy={status === "refreshing"}>
          {status === "refreshing" && (
            <div className="mb-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
              Actualizando…
            </div>
          )}
          {rows.slice(0, 10).map(row => {
            const label = `${row.key} · ${row.extra ?? "—"}`;
            const selected = selectedTechnician === row.key && selectedClient === row.extra;
            return (
              <AfterHoursBarRow
                key={`${row.key}__${row.extra}`}
                label={label}
                ariaLabel={`${row.key}, ${row.extra}, ${formatHours(row.after_hours_total_hours)} fuera de horario`}
                value={row.after_hours_total_hours}
                maxValue={max}
                valueLabel={formatHours(row.after_hours_total_hours)}
                selected={selected}
                onClick={onSelect ? () => onSelect(row) : undefined}
              />
            );
          })}
          {excludedTasks > 0 && (
            <div className="pt-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
              {formatInt(excludedTasks)} tarea(s) adicionales sin técnico y/o cliente identificables (no se muestran en esta lista).
            </div>
          )}
        </div>
      )}
    </AfterHoursSectionCard>
  );
}
