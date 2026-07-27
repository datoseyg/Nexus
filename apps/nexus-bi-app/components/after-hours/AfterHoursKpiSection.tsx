import { AfterHoursKpiTile } from "./AfterHoursKpiTile";
import { getConfidenceTierLabel } from "@/lib/after-hours-labels";
import { formatHours, formatInt, overallConfidenceScore, populationBreakdown } from "@/lib/after-hours-kpi-view";
import type { AfterHoursSummary } from "@/types/after-hours";

interface AfterHoursKpiSectionProps {
  summary: AfterHoursSummary;
}

// RESUMEN EJECUTIVO (ETAPA 6.6D §8) - grilla de 3 columnas x 2 filas fija
// (BLOQUEO DE FIDELIDAD VISUAL #3), igual que el prototipo. Las
// poblaciones CONTRACTUAL/LEGACY_SCHEDULE/NONE no entran a la grilla
// principal (el prototipo solo tiene 6 celdas) - se muestran como
// desglose secundario debajo, jerarquía explícita: métricas principales
// arriba, composición de población abajo, tarjeta oscura de confianza al
// final de la grilla principal (§8: "métricas principales arriba;
// poblaciones secundarias como desglose; tarjeta oscura para confianza").
export function AfterHoursKpiSection({ summary }: AfterHoursKpiSectionProps) {
  const confidenceTier = getConfidenceTierLabel(summary.kpis.totalHours.confidence_label || null);
  const confidenceScore = overallConfidenceScore(summary);

  return (
    <div className="mb-6">
      <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
        Resumen ejecutivo
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AfterHoursKpiTile label="Tareas analizadas" value={formatInt(summary.total_tasks)} />
        <AfterHoursKpiTile label="Tareas fuera de horario" value={formatInt(summary.kpis.tasksWithAfterHours.value)} />
        <AfterHoursKpiTile label="Horas fuera de horario" value={formatHours(summary.kpis.afterHoursHours.value)} />
        <AfterHoursKpiTile
          label="Técnicos involucrados"
          value={formatInt(summary.distinct_technicians)}
          accentColor="var(--nx-accent-indigo)"
          // HOTFIX auditoría After-Hours (§5) - este conteo es
          // COUNT(DISTINCT assigned_to): responsable principal únicamente,
          // nunca participantes adicionales (ver sql/082, la vista nunca lee
          // "NOMBRE DEL INGENIERO ADICIONAL"). El hint evita que se lea como
          // "todas las personas que trabajaron después de hora".
          hint="Responsable principal por tarea (assigned_to)"
        />
        <AfterHoursKpiTile label="Clientes involucrados" value={formatInt(summary.distinct_clients)} accentColor="var(--nx-accent-purple)" />
        <AfterHoursKpiTile
          label="Nivel general de confianza"
          value={
            confidenceScore === null ? (
              "—"
            ) : (
              <>
                {confidenceTier.label}{" "}
                <span className="text-sm font-semibold" style={{ color: "var(--nx-sidebar-text-muted)" }}>
                  ({confidenceScore.toLocaleString("es-CL", { maximumFractionDigits: 1 })})
                </span>
              </>
            )
          }
          tone="dark"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {populationBreakdown(summary).map(item => (
          <PopulationChip key={item.id} label={item.label} value={item.value} />
        ))}
      </div>
    </div>
  );
}

function PopulationChip({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[var(--nx-radius-chip)] px-3 py-2"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <div className="text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </div>
      <div className="text-[16px] font-bold [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
        {value.toLocaleString("es-CL")}
      </div>
    </div>
  );
}
