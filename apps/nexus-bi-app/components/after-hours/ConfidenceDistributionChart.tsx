"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConfidenceDistributionRow } from "@/types/after-hours";

interface ConfidenceDistributionChartProps {
  data: ConfidenceDistributionRow[];
}

const TIER_COLOR: Record<string, string> = {
  Insuficiente: "var(--eyg-danger)",
  Baja: "var(--eyg-warning)",
  Media: "var(--eyg-info)",
  Alta: "var(--eyg-green-dark)"
};

// Distribución de confiabilidad de los cálculos - a diferencia de los
// rankings de una sola serie (HorizontalBarChart), acá el color SÍ
// significa algo (nivel de confianza): cada barra usa su tono semántico en
// vez de un solo hue - ver skill dataviz § el color codifica estado.
export function ConfidenceDistributionChart({ data }: ConfidenceDistributionChartProps) {
  const hasData = data.some(d => d.task_count > 0);

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Distribución de confiabilidad de los cálculos
      </h3>
      {!hasData ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Sin datos.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" />
            <XAxis dataKey="confidence_label" tick={{ fill: "var(--text-secondary)", fontSize: 12 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--page-plane)" }}
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text-primary)"
              }}
              formatter={value => [value, "Tareas"]}
            />
            <Bar dataKey="task_count" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {data.map(entry => (
                <Cell key={entry.confidence_label} fill={TIER_COLOR[entry.confidence_label] ?? "var(--series-1)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
