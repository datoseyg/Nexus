"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

interface AfterHoursRankingCardProps {
  question: string;
  subtitle: string;
  rows: AfterHoursByDimensionRow[];
  limit?: number;
}

// Ranking de una sola serie (magnitud, no identidad) - técnicos, clientes o
// tipo de tarea (ETAPA 6.6D §9), conectados a by-technician/by-client/
// by-task-type. Mismo componente para los 3 (misma forma de fila:
// key + after_hours_total_hours).
export function AfterHoursRankingCard({ question, subtitle, rows, limit = 10 }: AfterHoursRankingCardProps) {
  const data = rows.slice(0, limit);
  const hasData = data.length > 0;

  return (
    <AfterHoursSectionCard question={question} subtitle={subtitle}>
      {!hasData ? (
        <AfterHoursEmptyBlock layout="column" title="Información todavía no disponible" />
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--nx-border)" />
            <XAxis type="number" tick={{ fill: "var(--nx-text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
            <YAxis type="category" dataKey="key" width={140} tick={{ fill: "var(--nx-text-secondary)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--nx-page-bg)" }}
              contentStyle={{ background: "var(--nx-card-bg)", border: "1px solid var(--nx-border)", borderRadius: 8, fontSize: 12, color: "var(--nx-text-primary)" }}
              formatter={value => [`${value} h`, "Horas fuera de horario"]}
            />
            <Bar dataKey="after_hours_total_hours" fill="var(--nx-accent-indigo)" radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </AfterHoursSectionCard>
  );
}
