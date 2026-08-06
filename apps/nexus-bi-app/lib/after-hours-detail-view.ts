// Helpers puros compartidos por AfterHoursDetailTable.tsx y el drawer
// canónico de reporte (ETAPA 6.6D §11/§12; Sección 14 del encargo NEXUS V3
// After-Hours) - extraídos a lib/ para quedar testeables con node --test
// (los .tsx con JSX no pueden importarse en el runner de tests, que solo
// despoja tipos, no transforma JSX).
import { getCoverageClassificationLabel, getDataBasisLabel, getFallbackLabel, getReasonCodeLabel, getConfidenceTierLabel, type CodeLabel } from "./after-hours-labels";
import type { AfterHoursDetailRow } from "@/types/after-hours";
import { ANALYSIS_INTERVAL_BASIS_LABEL } from "./fieldbeat-report-labels";

// Divide un valor "YYYY-MM-DD HH:mm:ss" (o con 'T') en fecha/hora legibles.
// Nunca lanza con null/valores mal formados - degrada a "-".
export function splitDateTime(value: string | null): { date: string; time: string } {
  if (!value) return { date: "-", time: "-" };
  const [date, time] = value.replace(" ", "T").split("T");
  return { date: date ?? "-", time: time ? time.slice(0, 5) : "-" };
}

interface AfterHoursBreakdownFields {
  business_hours: number | null;
  after_hours: number | null;
  weekend_hours: number | null;
  holiday_hours: number | null;
}

// Suma weekday+weekend+holiday fuera de horario. Retorna null cuando
// business_hours es null (cobertura no calculable, data_basis=NONE) - la UI
// debe pintar "—", NUNCA "0 min" para una tarea no calculable (§11).
export function totalAfterHoursHours(row: AfterHoursBreakdownFields): number | null {
  if (row.business_hours === null) return null;
  return (row.after_hours ?? 0) + (row.weekend_hours ?? 0) + (row.holiday_hours ?? 0);
}

// Formato es-CL con 1 decimal + unidad "h"; null -> "—" (nunca "0 h").
export function formatHoursOrDash(value: number | null): string {
  return value === null ? "—" : `${(Math.round(value * 10) / 10).toLocaleString("es-CL")} h`;
}

// Sección 14.4 del encargo NEXUS V3 After-Hours - decide si una fila debe
// pintarse como seleccionada, extraída como función pura testeable (el
// componente .tsx no puede importarse en el runner de tests). Casos: mismo
// id -> true; id distinto -> false; selectedTaskId=null (nada seleccionado,
// ej. drawer cerrado) -> siempre false.
export function isAfterHoursRowSelected(taskId: number, selectedTaskId: number | null): boolean {
  return selectedTaskId !== null && taskId === selectedTaskId;
}

// Buscador de reporte (encabezado de AfterHoursDetailTable) - normaliza lo
// que el usuario escribe ("3811", "#3811", "# 3811") a un entero positivo
// seguro, o null si la entrada no es válida. Nunca usa parseInt permisivo
// (parseInt("38a11") = 38 sería un falso positivo real) - valida la cadena
// completa con regex antes de convertir con Number(). Tras trim(), elimina
// solo un "#" inicial y los espacios inmediatamente posteriores; el resto
// debe ser dígitos puros sin signo ni ceros a la izquierda (fieldbeat_task_id
// nunca es 0 ni negativo).
export function parseReportIdInput(raw: string): number | null {
  const trimmed = raw.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1).trimStart() : trimmed;
  if (!/^[1-9]\d*$/.test(withoutHash)) return null;
  const value = Number(withoutHash);
  return Number.isSafeInteger(value) ? value : null;
}

// Sección 14 del encargo NEXUS V3 After-Hours - traduce el arreglo
// resolved_models (ARRAY_AGG DISTINCT, ya sin nulls) que trae la fila de
// app/api/dashboard/after-hours/detail/route.ts a {model, model_resolution_status}.
// Deliberadamente solo RESOLVED/UNKNOWN a este nivel (nunca AMBIGUOUS): la
// ambigüedad de un equipo puntual (2+ contratos vigentes en desacuerdo para
// ESE equipo) ya se descarta en SQL (item.model queda NULL, el FILTER lo
// excluye del arreglo) - lo que este helper decide es solo "hay 0, 1 o 2+
// modelos distintos ya resueltos para listar", nunca si alguno de ellos es
// en sí mismo ambiguo. 2+ modelos distintos (tarea con varios equipos) se
// listan juntos con " / " (mismo separador que formatDistinctList en
// lib/explorer-entity-config.ts), nunca se elige uno arbitrariamente.
export function resolveRowModel(resolvedModels: readonly string[] | null): { model: string | null; model_resolution_status: "RESOLVED" | "UNKNOWN" } {
  const distinct = (resolvedModels ?? []).filter((m): m is string => typeof m === "string" && m.length > 0);
  if (distinct.length === 0) return { model: null, model_resolution_status: "UNKNOWN" };
  return { model: distinct.join(" / "), model_resolution_status: "RESOLVED" };
}

// Contexto propio de After-Hours para el drawer canónico de reporte
// (FieldbeatReportDetailDrawer/Content) - Sección 14 del encargo. Compuesto
// EN EL CLIENTE desde la fila que la tabla ya cargó (cero fetch adicional,
// nunca se mezcla con el contrato compartido FieldbeatReportDetail). Es un
// port directo de la lógica que antes vivía en AfterHoursDrawer.tsx (ahora
// eliminado) - mismas 4 secciones/labels, con la corrección de rótulo
// "Tiempo cubierto"/"Tiempo fuera de cobertura" (antes decían "Minutos"
// para un valor formateado en horas, inconsistencia semántica real).
export interface AfterHoursDrawerContext {
  analysisStartLabel: string;
  analysisEndLabel: string;
  durationLabel: string;
  analysisIntervalBasisLabel: string;
  analysisFallbackUsed: boolean;
  analysisFallbackReason: string | null;
  coveredTimeLabel: string;
  uncoveredTimeLabel: string;
  weekdayAfterHoursLabel: string;
  weekendLabel: string;
  holidayLabel: string;
  dataBasis: CodeLabel;
  /** Código crudo de dataBasis (Bloque 2 NEXUS V3) - CodeLabel no expone el
   * código original, solo label/shortLabel/description/severity; este campo
   * es lo que permite al drawer decidir si el horario mostrado en
   * ContractCoverageScheduleView es el contractual real o el fallback
   * global, sin comparar contra un texto de label (frágil). */
  dataBasisCode: string | null;
  coverage: CodeLabel;
  finalReason: CodeLabel;
  contractualReason: CodeLabel | null;
  fallback: CodeLabel;
  temporalConfidenceText: string;
  contractualConfidenceText: string | null;
}

export function buildAfterHoursDrawerContext(row: AfterHoursDetailRow): AfterHoursDrawerContext {
  const start = splitDateTime(row.analysis_start_time);
  const end = splitDateTime(row.analysis_end_time);
  const total = totalAfterHoursHours(row);

  const dataBasis = getDataBasisLabel(row.data_basis);
  const coverage = getCoverageClassificationLabel(row.coverage_classification);
  const finalReason = getReasonCodeLabel(row.coverage_reason_code);
  const contractualReason = row.contractual_reason_code ? getReasonCodeLabel(row.contractual_reason_code) : null;
  const fallback = getFallbackLabel(row.fallback_used);
  const temporalConfidence = getConfidenceTierLabel(row.confidence_label);
  const contractualConfidence = row.data_basis === "CONTRACTUAL" ? getConfidenceTierLabel(row.contract_resolution_label) : null;

  return {
    analysisStartLabel: start.date === "-" ? "-" : `${start.date} ${start.time}`,
    analysisEndLabel: end.date === "-" ? "-" : `${end.date} ${end.time}`,
    durationLabel: formatHoursOrDash(row.duration_hours),
    analysisIntervalBasisLabel: ANALYSIS_INTERVAL_BASIS_LABEL[row.analysis_interval_basis] ?? row.analysis_interval_basis,
    analysisFallbackUsed: row.analysis_fallback_used,
    analysisFallbackReason: row.analysis_fallback_reason,
    coveredTimeLabel: formatHoursOrDash(row.business_hours),
    uncoveredTimeLabel: formatHoursOrDash(total),
    weekdayAfterHoursLabel: formatHoursOrDash(row.after_hours),
    weekendLabel: formatHoursOrDash(row.weekend_hours),
    holidayLabel: formatHoursOrDash(row.holiday_hours),
    dataBasis,
    dataBasisCode: row.data_basis ?? null,
    coverage,
    finalReason,
    contractualReason,
    fallback,
    temporalConfidenceText: row.confidence_score === null ? "—" : `${Math.round(row.confidence_score)} · ${temporalConfidence.label}`,
    contractualConfidenceText:
      contractualConfidence && row.contract_resolution_confidence !== null ? `${Math.round(row.contract_resolution_confidence)} · ${contractualConfidence.label}` : null
  };
}
