import { HorizontalBarChart } from "@/components/HorizontalBarChart";
import type { LifecycleAggregateRow } from "@/types/equipment-lifecycle";

interface ComparisonData {
  machine: LifecycleAggregateRow | null;
  siblingMachines: LifecycleAggregateRow[];
  otherClients: LifecycleAggregateRow[];
  global: LifecycleAggregateRow | null;
}

interface PartComparisonChartProps {
  data: ComparisonData | null;
  loading: boolean;
}

function avgEstimatedLife(rows: LifecycleAggregateRow[]): number | null {
  const values = rows.map(r => r.estimated_life_days).filter((v): v is number => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Compara la vida estimada del mismo repuesto en: esta máquina, otras
// máquinas del mismo cliente, otros clientes, y el promedio global (Parte
// 8.6). Reusa HorizontalBarChart en vez de un gráfico ad-hoc - es una sola
// serie de magnitud (días), no una comparación de identidad.
export function PartComparisonChart({ data, loading }: PartComparisonChartProps) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-muted)" }}>
        Cargando comparación...
      </div>
    );
  }

  if (!data || !data.machine) {
    return (
      <div className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-muted)" }}>
        Selecciona un repuesto con vida útil estimada para compararlo.
      </div>
    );
  }

  const chartData = [
    { key: "Esta máquina", estimated_life_days: data.machine.estimated_life_days ?? 0 },
    { key: "Otras máquinas (mismo cliente)", estimated_life_days: avgEstimatedLife(data.siblingMachines) ?? 0 },
    { key: "Otros clientes", estimated_life_days: avgEstimatedLife(data.otherClients) ?? 0 },
    { key: "Promedio global observado", estimated_life_days: data.global?.estimated_life_days ?? 0 }
  ];

  return (
    <HorizontalBarChart
      title="Vida útil estimada: esta máquina vs. otras referencias"
      data={chartData}
      categoryKey="key"
      valueKey="estimated_life_days"
      valueLabel="Días estimados"
    />
  );
}
