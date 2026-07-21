import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatNumberEsCl } from "@/lib/dashboard-formatters";
import type { FieldbeatCrossSeries } from "@/types/fieldbeat";

interface FieldbeatCrossMatrixProps {
  title: string;
  description?: string;
  data: FieldbeatCrossSeries;
  columnLabel: string;
  loading?: boolean;
}

// ETAPA 6 - reemplaza los 2 FieldbeatUnavailablePlaceholder de cruce
// (cliente x equipo, cliente x tipo de tarea, ETAPA 5-V). Tabla simple en
// vez de una matriz de gráfico de barras apiladas (como
// OperationalDashboardTab.tsx) - misma información (cliente x categoría =
// cantidad), corrección mínima: no introduce una nueva librería de
// visualización solo para esta pantalla.
export function FieldbeatCrossMatrix({ title, description, data, columnLabel, loading = false }: FieldbeatCrossMatrixProps) {
  const columns = data.equipos ?? data.tiposTarea ?? [];

  if (loading) {
    return (
      <SectionCard title={title} description={description}>
        <div className="h-24 animate-pulse rounded" style={{ background: "var(--nx-page-bg)" }} />
      </SectionCard>
    );
  }

  if (data.clientes.length === 0 || columns.length === 0) {
    return (
      <SectionCard title={title} description={description}>
        <EmptyState title="Sin datos disponibles" description="No hay registros para este cruce en el universo actual." />
      </SectionCard>
    );
  }

  return (
    <SectionCard title={title} description={description}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
          <thead>
            <tr>
              <th className="p-1.5 text-left" style={{ color: "var(--nx-text-muted)" }}>
                Cliente
              </th>
              {columns.map(col => (
                <th key={col} className="p-1.5 text-right" style={{ color: "var(--nx-text-muted)" }} title={col}>
                  {col.length > 18 ? `${col.slice(0, 16)}…` : col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.clientes.map((cliente, ci) => (
              <tr key={cliente} style={{ borderTop: "1px solid var(--nx-border)" }}>
                <td className="p-1.5 font-semibold" title={cliente}>
                  {cliente}
                </td>
                {data.series.map((serie, si) => (
                  <td key={si} className="p-1.5 text-right [font-variant-numeric:tabular-nums]">
                    {formatNumberEsCl(serie.data[ci] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px]" style={{ color: "var(--nx-text-muted)" }}>
        Top {data.clientes.length} clientes x top {columns.length} {columnLabel}, por cantidad de reportes.
      </p>
    </SectionCard>
  );
}
