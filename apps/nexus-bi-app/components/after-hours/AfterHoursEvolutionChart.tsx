"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { EVOLUTION_METRICS, getEvolutionMetric, type EvolutionMetricKey } from "@/lib/after-hours-evolution-view";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

interface AfterHoursEvolutionChartProps {
  rows: AfterHoursByDimensionRow[];
  status?: "idle" | "loading" | "refreshing" | "success" | "empty" | "error";
  error?: string | null;
  onRetry?: () => void;
}

// "¿Cómo evoluciona la actividad fuera de horario?" - conectada a
// by-period (ETAPA 6.6D §9), ancho completo (BLOQUEO DE FIDELIDAD VISUAL
// #5). Una sola serie visible a la vez (magnitud, no identidad) -> un solo
// hue, sin leyenda, mismo criterio que el resto de la app (skill dataviz).
//
// ETAPA 6.6D: agrega un selector de métrica (horas fuera de horario /
// tareas totales / tareas fuera de horario / tasa %) - nunca ejes duales
// ni series mezcladas, solo cambia CUÁL campo de la misma fila
// (AfterHoursByDimensionRow, ya presente en la respuesta real de
// by-period) se grafica.
export function AfterHoursEvolutionChart({ rows, status = "success", error, onRetry }: AfterHoursEvolutionChartProps) {
  const [metricKey, setMetricKey] = useState<EvolutionMetricKey>("after_hours_hours");
  const metric = getEvolutionMetric(metricKey);
  const hasData = rows.length > 0;

  const chartData = rows.map(r => ({ key: r.key, value: metric.getValue(r) }));

  return (
    <AfterHoursSectionCard question="¿Cómo evoluciona la actividad fuera de horario?" subtitle="Por período">
      <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Métrica a graficar">
        {EVOLUTION_METRICS.map(m => {
          const isActive = m.key === metricKey;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setMetricKey(m.key)}
              className="rounded-[var(--nx-radius-pill)] px-3 py-1 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              style={{
                background: isActive ? "var(--nx-accent-indigo)" : "var(--nx-page-bg)",
                color: isActive ? "#ffffff" : "var(--nx-text-secondary)",
                outlineColor: "var(--nx-focus-ring-color)"
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {status === "error" ? (
        <AfterHoursEmptyBlock tone="error" title="No se pudo cargar esta sección" description={error ?? "Intenta nuevamente en unos minutos."} onRetry={onRetry} />
      ) : status === "loading" ? (
        <div className="h-[260px] animate-pulse rounded" style={{ background: "var(--nx-page-bg)" }} aria-live="polite" aria-busy="true" />
      ) : !hasData ? (
        <AfterHoursEmptyBlock title="Información todavía no disponible" description="La evolución por período se mostrará cuando esté disponible." />
      ) : (
        <div style={status === "refreshing" ? { opacity: 0.6 } : undefined} aria-busy={status === "refreshing"}>
          {status === "refreshing" && (
            <div className="mb-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
              Actualizando…
            </div>
          )}
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--nx-border)" />
              <XAxis dataKey="key" tick={{ fill: "var(--nx-text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--nx-text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} unit={metric.unit === "%" ? "%" : ""} />
              <Tooltip
                cursor={{ fill: "var(--nx-page-bg)" }}
                contentStyle={{ background: "var(--nx-card-bg)", border: "1px solid var(--nx-border)", borderRadius: 8, fontSize: 12, color: "var(--nx-text-primary)" }}
                formatter={value => [metric.formatValue(Number(value)), metric.label]}
              />
              <Bar dataKey="value" fill="var(--nx-accent-indigo)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AfterHoursSectionCard>
  );
}
