import type { AfterHoursSummary } from "@/types/after-hours";

// Lógica pura de composición del Resumen Ejecutivo y del bloque de
// confianza (ETAPA 6.6D §8/§10) - extraída de AfterHoursKpiSection.tsx y
// AfterHoursConfidenceSection.tsx para quedar testeable (los .tsx con JSX
// no pueden importarse en el runner de node --test).

export function formatInt(n: number): string {
  return n.toLocaleString("es-CL");
}

export function formatHours(n: number): string {
  return `${(Math.round(n * 10) / 10).toLocaleString("es-CL")} h`;
}

// Confianza general: solo tiene sentido si existe al menos 1 tarea
// calculable - de lo contrario el score subyacente es un artefacto del
// backend (nunca debe mostrarse como si fuera un 0 real). null -> la UI
// pinta "—", nunca un score falso (§8: "Absent data → '—', never convert
// absence to zero").
export function overallConfidenceScore(summary: AfterHoursSummary): number | null {
  return summary.calculable_tasks > 0 ? summary.kpis.totalHours.confidence_score : null;
}

export function afterHoursConfidenceScore(summary: AfterHoursSummary): number | null {
  return summary.kpis.tasksWithAfterHours.value > 0 ? summary.kpis.tasksWithAfterHours.confidence_score : null;
}

export function notCalculableConfidenceScore(summary: AfterHoursSummary): number | null {
  return summary.none_tasks > 0 ? summary.kpis.tasksNotCalculable.confidence_score : null;
}

// Confianza de resolución CONTRACTUAL solo se muestra cuando existe al
// menos 1 tarea con esa base de cálculo (§10: "Never show contractual
// confidence when contractual_tasks=0").
export function showContractualConfidence(summary: AfterHoursSummary): boolean {
  return summary.contractual_tasks > 0;
}

export interface PopulationBreakdownItem {
  id: string;
  label: string;
  value: number;
}

// Desglose secundario de población CONTRACTUAL/LEGACY_SCHEDULE/NONE
// (§8) - orden fijo, igual al que renderiza AfterHoursKpiSection debajo
// de la grilla 3x2 principal.
export function populationBreakdown(summary: AfterHoursSummary): PopulationBreakdownItem[] {
  return [
    { id: "calculable", label: "Tareas calculables", value: summary.calculable_tasks },
    { id: "contractual", label: "Con contrato", value: summary.contractual_tasks },
    { id: "legacy", label: "Con horario global", value: summary.legacy_schedule_tasks },
    { id: "none", label: "No calculables", value: summary.none_tasks }
  ];
}
