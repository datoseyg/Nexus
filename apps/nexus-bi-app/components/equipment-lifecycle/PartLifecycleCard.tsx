import { MetricCardWithConfidence } from "@/components/ui/MetricCardWithConfidence";
import type { LifecycleAggregateRow } from "@/types/equipment-lifecycle";

interface PartLifecycleCardProps {
  row: LifecycleAggregateRow | null;
}

function round1(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return (Math.round(value * 10) / 10).toString();
}

function formatWeightPct(value: number | null): string {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

// Detalle del repuesto seleccionado dentro de la máquina - vida estimada
// con su confiabilidad (MetricCardWithConfidence ya muestra "Usar con
// cautela"/"Cálculo preliminar" automáticamente según el score) + la
// explicación matemática de por qué se eligió ese modelo (Parte 11.5) -
// todo el copy sale de columnas ya calculadas en GOLD
// (model_reason/machine_weight/cohort_source), nunca texto inventado en
// el frontend.
export function PartLifecycleCard({ row }: PartLifecycleCardProps) {
  if (!row) {
    return (
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", color: "var(--text-secondary)" }}>
        Selecciona un repuesto de la tabla para ver su detalle.
      </div>
    );
  }

  const hasShrinkageWeights = row.machine_weight !== null && row.cohort_weight !== null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCardWithConfidence
          label="Vida útil estimada"
          value={row.estimated_life_days}
          unit="días"
          hint={row.estimated_life_months !== null ? `≈ ${round1(row.estimated_life_months)} meses` : undefined}
          confidence={{ score: row.model_confidence_score, label: row.model_confidence_label, factors: row.model_confidence_factors }}
          isEstimated
        />
        <MetricCardWithConfidence
          label="Tasa de reemplazo anual"
          value={row.replacement_rate_per_year}
          unit="/ año"
          confidence={{ score: row.model_confidence_score, label: row.model_confidence_label }}
          isEstimated
        />
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Dispersión de intervalos observados
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs" style={{ color: "var(--text-primary)" }}>
            <div>Mediana: {round1(row.median_interval_days)} d</div>
            <div>Promedio: {round1(row.avg_interval_days)} d</div>
            <div>Mín-Máx: {round1(row.min_interval_days)}-{round1(row.max_interval_days)} d</div>
            <div>P10-P90: {round1(row.estimated_life_p10_days)}-{round1(row.estimated_life_p90_days)} d</div>
            <div>Intervalo creíble: {round1(row.credible_interval_low_days)}-{round1(row.credible_interval_high_days)} d</div>
            <div>Eventos/Intervalos: {row.n_events} / {row.n_intervals}</div>
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Comparación con fabricante
          </div>
          <div className="mt-2 text-xs" style={{ color: "var(--text-primary)" }}>
            {row.manufacturer_life_source === "NO_DATA" || !row.manufacturer_life_months
              ? "Sin dato de especificación de fabricante cargado."
              : `Fabricante: ${row.manufacturer_life_months} meses (${row.comparison_to_manufacturer})`}
          </div>
          {row.notes && (
            <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {row.notes}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Por qué se eligió este modelo
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--text-primary)" }}>
          {row.model_reason}
        </p>
        {hasShrinkageWeights && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            El cálculo combina {formatWeightPct(row.machine_weight)} de historial propio de esta máquina y {formatWeightPct(row.cohort_weight)} de historial de cohorte
            {row.cohort_source ? ` (${row.cohort_source})` : ""}.
          </p>
        )}
        {row.statistical_notes && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {row.statistical_notes}
          </p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Advertencia metodológica: esta estimación es evidencia operacional observada en los datos de E&amp;G, no reemplaza especificaciones del fabricante ni prueba causalidad.
        </p>
      </div>
    </div>
  );
}
