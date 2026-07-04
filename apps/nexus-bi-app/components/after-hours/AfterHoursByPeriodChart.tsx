"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

interface AfterHoursByPeriodChartProps {
  data: AfterHoursByDimensionRow[];
}

// "Horas fuera de horario por mes" - serie única (magnitud, no identidad),
// un solo hue (--series-1), sin leyenda, mismo idioma que
// components/HorizontalBarChart.tsx (ver skill dataviz).
export function AfterHoursByPeriodChart({ data }: AfterHoursByPeriodChartProps) {
  const hasData = data.length > 0;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Horas fuera de horario por mes
      </h3>
      {!hasData ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Sin datos.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="key" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--page-plane)" }}
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text-primary)"
              }}
              formatter={value => [value, "Horas fuera de horario"]}
            />
            <Bar dataKey="after_hours_total_hours" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
