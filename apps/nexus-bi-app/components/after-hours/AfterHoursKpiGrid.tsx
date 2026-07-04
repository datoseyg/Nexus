import { SectionCard } from "@/components/ui/SectionCard";
import { MetricCardWithConfidence } from "@/components/ui/MetricCardWithConfidence";
import type { AfterHoursSummary } from "@/types/after-hours";

interface AfterHoursKpiGridProps {
  summary: AfterHoursSummary | null;
  loading: boolean;
}

function round1(value: number | undefined): number {
  return Math.round((value ?? 0) * 10) / 10;
}

// Los 6 KPIs pedidos, cada uno con su propia confiabilidad - ver
// docs/AFTER_HOURS_METRICS.md § interpretación de KPIs.
export function AfterHoursKpiGrid({ summary, loading }: AfterHoursKpiGridProps) {
  return (
    <SectionCard title="Indicadores" description={loading ? "Cargando…" : undefined}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCardWithConfidence
          label="Horas totales registradas"
          value={round1(summary?.kpis.totalHours.value)}
          unit="h"
          hint="SUM(duration_minutes) / 60"
          confidence={{
            score: summary?.kpis.totalHours.confidence_score ?? 0,
            label: summary?.kpis.totalHours.confidence_label ?? "-",
            factors: summary?.kpis.totalHours.confidence_factors_summary
          }}
        />
        <MetricCardWithConfidence
          label="Horas hábiles estimadas"
          value={round1(summary?.kpis.businessHours.value)}
          unit="h"
          hint="Dentro del horario configurado - ver horario en la nota superior"
          isEstimated
          confidence={{
            score: summary?.kpis.businessHours.confidence_score ?? 0,
            label: summary?.kpis.businessHours.confidence_label ?? "-",
            factors: summary?.kpis.businessHours.confidence_factors_summary
          }}
        />
        <MetricCardWithConfidence
          label="Horas fuera de horario"
          value={round1(summary?.kpis.afterHoursHours.value)}
          unit="h"
          hint="Incluye noche/madrugada en día hábil, fin de semana y feriados"
          isEstimated
          confidence={{
            score: summary?.kpis.afterHoursHours.confidence_score ?? 0,
            label: summary?.kpis.afterHoursHours.confidence_label ?? "-",
            factors: summary?.kpis.afterHoursHours.confidence_factors_summary
          }}
        />
        <MetricCardWithConfidence
          label="% fuera de horario"
          value={round1((summary?.kpis.afterHoursRate.value ?? 0) * 100)}
          unit="%"
          hint="Horas fuera de horario ÷ horas totales"
          isEstimated
          confidence={{
            score: summary?.kpis.afterHoursRate.confidence_score ?? 0,
            label: summary?.kpis.afterHoursRate.confidence_label ?? "-",
            factors: summary?.kpis.afterHoursRate.confidence_factors_summary
          }}
        />
        <MetricCardWithConfidence
          label="Tareas con trabajo fuera de horario"
          value={summary?.kpis.tasksWithAfterHours.value ?? 0}
          unit="tareas"
          confidence={{
            score: summary?.kpis.tasksWithAfterHours.confidence_score ?? 0,
            label: summary?.kpis.tasksWithAfterHours.confidence_label ?? "-",
            factors: summary?.kpis.tasksWithAfterHours.confidence_factors_summary
          }}
        />
        <MetricCardWithConfidence
          label="Tareas no calculables"
          value={summary?.kpis.tasksNotCalculable.value ?? 0}
          unit="tareas"
          hint="calculation_status = NOT_CALCULABLE (start_time o duration_minutes inválidos)"
          confidence={{
            score: summary?.kpis.tasksNotCalculable.confidence_score ?? 0,
            label: summary?.kpis.tasksNotCalculable.confidence_label ?? "-",
            factors: summary?.kpis.tasksNotCalculable.confidence_factors_summary
          }}
        />
      </div>
    </SectionCard>
  );
}
