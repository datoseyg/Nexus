"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

interface AfterHoursEvolutionChartProps {
  rows: AfterHoursByDimensionRow[];
}

// "¿Cómo evoluciona la actividad fuera de horario?" - conectada a
// by-period (ETAPA 6.6D §9), ancho completo (BLOQUEO DE FIDELIDAD VISUAL
// #5). Una sola serie (magnitud, no identidad) -> un solo hue, sin
// leyenda, mismo criterio que el resto de la app (skill dataviz).
export function AfterHoursEvolutionChart({ rows }: AfterHoursEvolutionChartProps) {
  const hasData = rows.length > 0;

  return (
    <AfterHoursSectionCard question="¿Cómo evoluciona la actividad fuera de horario?" subtitle="Por período">
      {!hasData ? (
        <AfterHoursEmptyBlock title="Información todavía no disponible" description="La evolución por período se mostrará cuando esté disponible." />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--nx-border)" />
            <XAxis dataKey="key" tick={{ fill: "var(--nx-text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--nx-text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--nx-page-bg)" }}
              contentStyle={{ background: "var(--nx-card-bg)", border: "1px solid var(--nx-border)", borderRadius: 8, fontSize: 12, color: "var(--nx-text-primary)" }}
              formatter={value => [`${value} h`, "Horas fuera de horario"]}
            />
            <Bar dataKey="after_hours_total_hours" fill="var(--nx-accent-indigo)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </AfterHoursSectionCard>
  );
}
