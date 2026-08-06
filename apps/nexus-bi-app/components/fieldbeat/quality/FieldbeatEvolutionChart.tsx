"use client";

import { Line } from "react-chartjs-2";
import "@/lib/chartjs-setup";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { DASHBOARD_PALETTE } from "@/lib/dashboard-formatters";
import { EVOLUTION_SERIES, type EvolutionSeriesKey } from "@/lib/fieldbeat-tabs-url-state";
import { periodLabel } from "@/lib/fieldbeat-period-label";
import type { FieldbeatQualityEvolutionPoint } from "@/types/fieldbeat-quality";

interface FieldbeatEvolutionChartProps {
  points: FieldbeatQualityEvolutionPoint[];
  selected: EvolutionSeriesKey;
  onSelectedChange: (series: EvolutionSeriesKey) => void;
  loading?: boolean;
}

// Selector de evolución (Phase 3 §7) - las 4 series ya llegan juntas en
// /overview (nunca se recarga al cambiar de serie, solo cambia qué línea
// se dibuja). Un único hue por serie, orden categórico fijo (nunca
// ciclado) - ver skill dataviz: verde/teal/lime/info reservados en ese
// orden para completitud/inconsistencias/trazabilidad/equipos. Nunca
// actividad bruta - siempre un porcentaje con numerador/denominador real.
const SERIES_LABELS: Record<EvolutionSeriesKey, string> = {
  completeness: "Completitud estructural",
  inconsistencies: "Reportes con inconsistencias",
  traceability: "Trazabilidad de repuestos",
  equipmentIdentification: "Identificación de equipos"
};

const SERIES_COLORS: Record<EvolutionSeriesKey, string> = {
  completeness: DASHBOARD_PALETTE.green,
  inconsistencies: DASHBOARD_PALETTE.orange,
  traceability: DASHBOARD_PALETTE.teal,
  equipmentIdentification: DASHBOARD_PALETTE.info
};

export function FieldbeatEvolutionChart({ points, selected, onSelectedChange, loading }: FieldbeatEvolutionChartProps) {
  const labels = points.map(p => periodLabel(p.period));
  const values = points.map(p => p[selected].percentage ?? 0);
  const color = SERIES_COLORS[selected];

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[12px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          Serie de evolución
        </legend>
        {EVOLUTION_SERIES.map(key => {
          const isActive = key === selected;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelectedChange(key)}
              className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[12.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
              style={
                isActive
                  ? { background: SERIES_COLORS[key], color: "#fff" }
                  : { background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)", border: "1px solid var(--nx-border)" }
              }
            >
              {SERIES_LABELS[key]}
            </button>
          );
        })}
      </fieldset>

      <ChartCard
        title={SERIES_LABELS[selected]}
        subtitle="Porcentaje mensual - selector cambia la serie sin recargar datos."
        size="line"
        available={!loading && points.length > 0}
        unavailableReason={loading ? "Cargando…" : "Sin datos de evolución para el filtro actual."}
        accessibleData={{ labels, values, unitLabel: "meses", valueSuffix: "%" }}
      >
        <Line
          data={{
            labels,
            datasets: [
              {
                label: SERIES_LABELS[selected],
                data: values,
                borderColor: color,
                backgroundColor: "transparent",
                tension: 0.2,
                pointRadius: 2
              }
            ]
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.formattedValue}%` } } },
            scales: {
              y: { beginAtZero: true, max: 100, ticks: { font: { size: 12 }, callback: v => `${v}%` } },
              x: { ticks: { font: { size: 12 } } }
            }
          }}
        />
      </ChartCard>
    </div>
  );
}
