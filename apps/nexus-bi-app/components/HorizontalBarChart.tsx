"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface HorizontalBarChartProps {
  title: string;
  data: Array<Record<string, unknown>>;
  categoryKey: string;
  valueKey: string;
  valueLabel: string;
}

// Ranking de una sola serie (magnitud, no identidad) -> un solo hue
// (--series-1), sin leyenda (dataviz skill: "un solo color no necesita
// caja de leyenda"), extremos redondeados, tooltip al hover, grid/eje
// recesivos.
export function HorizontalBarChart({ title, data, categoryKey, valueKey, valueLabel }: HorizontalBarChartProps) {
  const hasData = data.length > 0;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>

      {!hasData ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Sin datos.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--gridline)" />
            <XAxis
              type="number"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey={categoryKey}
              width={160}
              tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--page-plane)" }}
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text-primary)"
              }}
              formatter={value => [value, valueLabel]}
            />
            <Bar dataKey={valueKey} fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
