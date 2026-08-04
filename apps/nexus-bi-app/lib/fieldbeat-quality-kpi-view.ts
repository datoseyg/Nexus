// Adaptadores puros de los 6 KPI v2 a un view-model de tarjeta genérico -
// nunca JSX acá, solo texto/tono, para poder testear sin DOM/React (Phase 3
// §6). Ningún KPI muestra "Información todavía no disponible" - un
// denominador cero se representa como isZeroDenominator=true con un
// mensaje explícito, nunca oculto ni fabricado.
//
// Tono: deliberadamente conservador. No se inventan umbrales de
// porcentaje "bueno/malo" sin evidencia de negocio (el propio encargo
// rechaza umbrales arbitrarios para el proxy temporal - mismo criterio se
// aplica acá) - el único tono no neutral es "attention", reservado para
// denominador cero o para KPI6 cuando existen reportes de severidad Alta
// (una señal real de la taxonomía, no un umbral inventado).
import type {
  Kpi1StructuralCompleteness,
  Kpi2TicketLinkage,
  Kpi3TeamIdentification,
  Kpi4PartsTraceability,
  Kpi5TemporalConsistency,
  Kpi6InformationInconsistencies
} from "@/types/fieldbeat-quality";

export type FieldbeatKpiTone = "neutral" | "attention";

export interface FieldbeatKpiCardViewModel {
  id: string;
  title: string;
  valueLabel: string;
  contextLabel: string;
  interpretation: string;
  tone: FieldbeatKpiTone;
  isZeroDenominator: boolean;
  drillDownLabel: string;
}

function pct(value: number | null): string {
  return value === null ? "Sin datos" : `${value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function intFmt(value: number): string {
  return value.toLocaleString("es-CL");
}

export function viewKpi1(kpi: Kpi1StructuralCompleteness): FieldbeatKpiCardViewModel {
  const isZero = kpi.denominator === 0;
  return {
    id: "kpi1",
    title: "Completitud estructural mínima",
    valueLabel: pct(kpi.percentage),
    contextLabel: `${intFmt(kpi.numerator)} / ${intFmt(kpi.denominator)} reportes cerrados`,
    interpretation: isZero
      ? "No hay reportes cerrados evaluables con los filtros actuales."
      : `${intFmt(kpi.missingTechnician)} sin técnico, ${intFmt(kpi.missingClient)} sin cliente, ${intFmt(kpi.missingEquipment)} sin equipo identificado (${intFmt(kpi.multipleMissing)} con más de un campo faltante).`,
    tone: isZero ? "attention" : "neutral",
    isZeroDenominator: isZero,
    drillDownLabel: "Ver reportes con campos faltantes"
  };
}

export function viewKpi2(kpi: Kpi2TicketLinkage): FieldbeatKpiCardViewModel {
  const isZero = kpi.evaluableReports === 0;
  return {
    id: "kpi2",
    title: "Vinculación verificable con tickets",
    valueLabel: pct(kpi.percentage),
    contextLabel: `${intFmt(kpi.reportsWithAccessibleTicket)} / ${intFmt(kpi.evaluableReports)} tickets informados`,
    interpretation: isZero
      ? "No hay reportes con ticket informado evaluables con los filtros actuales."
      : `${intFmt(kpi.reportsWithMissingOrRestrictedTicket)} informan un ticket ausente o restringido. ${intFmt(kpi.reportsWithoutReportedTicket)} reportes no informan ticket (contexto, no penaliza el KPI).`,
    tone: isZero ? "attention" : "neutral",
    isZeroDenominator: isZero,
    drillDownLabel: "Ver tickets ausentes o restringidos"
  };
}

export function viewKpi3(kpi: Kpi3TeamIdentification): FieldbeatKpiCardViewModel {
  const isZero = kpi.denominator === 0;
  return {
    id: "kpi3",
    title: "Identificación de equipos",
    valueLabel: pct(kpi.percentage),
    contextLabel: `${intFmt(kpi.numerator)} / ${intFmt(kpi.denominator)} reportes cerrados`,
    interpretation: isZero
      ? "No hay reportes cerrados evaluables con los filtros actuales."
      : `Estructurado: ${intFmt(kpi.structured)} · Texto confiable: ${intFmt(kpi.textConfident)} · Ambiguo: ${intFmt(kpi.textAmbiguous)} · Ausente: ${intFmt(kpi.missing)}${kpi.notApplicable > 0 ? ` · No aplica: ${intFmt(kpi.notApplicable)}` : ""}.`,
    tone: isZero ? "attention" : "neutral",
    isZeroDenominator: isZero,
    drillDownLabel: "Ver reportes sin equipo identificado"
  };
}

export function viewKpi4(kpi: Kpi4PartsTraceability): FieldbeatKpiCardViewModel {
  const isZero = kpi.reportGrain.universe === 0;
  const pctValue = isZero ? null : Math.round((kpi.reportGrain.fullyTraceable / kpi.reportGrain.universe) * 1000) / 10;
  return {
    id: "kpi4",
    title: "Trazabilidad de repuestos",
    valueLabel: pct(pctValue),
    contextLabel: `${intFmt(kpi.reportGrain.fullyTraceable)} / ${intFmt(kpi.reportGrain.universe)} reportes con repuestos`,
    interpretation: isZero
      ? "No hay reportes con repuestos evaluables con los filtros actuales."
      : `Grano línea: ${intFmt(kpi.lineGrain.directMatches)} match directo, ${intFmt(kpi.lineGrain.historicalAliasMatches)} alias histórico, ${intFmt(kpi.lineGrain.noMatch)} sin match, ${intFmt(kpi.lineGrain.ambiguous)} ambiguos, ${intFmt(kpi.lineGrain.placeholders)} placeholder (de ${intFmt(kpi.lineGrain.totalLines)} líneas).`,
    tone: isZero ? "attention" : "neutral",
    isZeroDenominator: isZero,
    drillDownLabel: "Ver repuestos no trazables"
  };
}

export function viewKpi5(kpi: Kpi5TemporalConsistency): FieldbeatKpiCardViewModel {
  const isZero = kpi.evaluableReports === 0;
  return {
    id: "kpi5",
    title: "Metadatos temporales del registro",
    valueLabel: pct(kpi.percentage),
    contextLabel: `${intFmt(kpi.consistentReports)} / ${intFmt(kpi.evaluableReports)} reportes con timestamps suficientes`,
    interpretation: isZero
      ? "No hay reportes con timestamps suficientes con los filtros actuales."
      : `${intFmt(kpi.impossibleChronology)} con transición administrativa anterior a la programación (dato descriptivo, no issue) · ${intFmt(kpi.zeroDurationWarnings)} con duración cero · ${intFmt(kpi.nullDurationWarnings)} con duración sin registrar (advertencias).`,
    tone: isZero ? "attention" : "neutral",
    isZeroDenominator: isZero,
    drillDownLabel: "Ver metadatos temporales"
  };
}

export function viewKpi6(kpi: Kpi6InformationInconsistencies): FieldbeatKpiCardViewModel {
  const isZero = kpi.evaluableReports === 0;
  return {
    id: "kpi6",
    title: "Reportes con inconsistencias de información",
    valueLabel: pct(kpi.percentage),
    contextLabel: `${intFmt(kpi.affectedReports)} / ${intFmt(kpi.evaluableReports)} reportes`,
    interpretation: isZero
      ? "No hay reportes evaluables con los filtros actuales."
      : `Alta: ${intFmt(kpi.highSeverityReports)} · Media: ${intFmt(kpi.mediumSeverityReports)} · Baja: ${intFmt(kpi.lowSeverityReports)} · Advertencia: ${intFmt(kpi.warningOnlyReports)}${kpi.dominantCode ? ` · Causa principal: ${kpi.dominantCode}` : ""}.`,
    tone: kpi.highSeverityReports > 0 ? "attention" : "neutral",
    isZeroDenominator: isZero,
    drillDownLabel: "Ver reportes con inconsistencias"
  };
}
