import { formatPercent } from "./dashboard-formatters";
import type { FieldbeatKpis } from "@/types/fieldbeat";

// ETAPA 5 - derivación de KPI de FieldBeat, sin JSX. Todo porcentaje
// mostrado se CALCULA desde conteos ya normalizados (parseCount, ver
// lib/fieldbeat-contract.ts) y un denominador demostrable - los 3 campos
// TEXT preformateados de kpis (zendesk_link_rate/used_parts_match_rate/
// review_required_rate) nunca son la fuente de un hint visual, solo se
// usan en tests de consistencia (ver test/fieldbeat/metrics.test.ts).

/**
 * @returns numerator/denominator, o null si denominator<=0 (nunca
 * NaN/Infinity).
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * @returns el porcentaje formateado en-CL (coma decimal + " %"), o "-" si
 * el denominador es <=0.
 */
export function percentLabel(numerator: number, denominator: number, decimals = 1): string {
  const ratio = safeRatio(numerator, denominator);
  if (ratio === null) return "-";
  return formatPercent(ratio * 100, decimals);
}

// ETAPA 5-V - grilla ejecutiva de 6 POSICIONES FIJAS, exactamente las del
// mockup (docs/design-revolution/Nexus - Dashboard FieldBeat.dc.html):
// Reportes de terreno / Clientes con actividad / Equipos atendidos / Tipo
// de trabajo predominante / Reportes con repuesto registrado / Actividad
// más reciente. Nunca se sustituye esta composición por otras 6 métricas
// reales solo porque existen en el contrato (esa fue la desviación
// corregida de ETAPA 5) - 3 de las 6 posiciones son honestamente
// "unavailable" SIEMPRE, incluso con kpis presente, porque ningún campo
// del contrato las respalda (ver docs/design-revolution/... - "Clientes
// con actividad"/"Equipos atendidos" serían `.length` de un ranking
// top-10, prohibido desde ETAPA 6.6D-FIX-1; "Actividad más reciente"
// necesitaría un campo de recencia inexistente).
export type FieldbeatKpiSlotAccent = "green" | "purple" | "dark" | "default";

export interface FieldbeatKpiSlotAvailable {
  status: "available";
  label: string;
  value: number;
  hint?: string;
  accent: FieldbeatKpiSlotAccent;
}

export interface FieldbeatKpiSlotUnavailable {
  status: "unavailable";
  label: string;
  reason: string;
  accent: FieldbeatKpiSlotAccent;
}

export type FieldbeatKpiSlot = FieldbeatKpiSlotAvailable | FieldbeatKpiSlotUnavailable;

export interface FieldbeatExecutiveSummaryViewModel {
  totalReports: FieldbeatKpiSlot;
  clientsWithActivity: FieldbeatKpiSlot;
  equipmentAttended: FieldbeatKpiSlot;
  predominantTaskType: FieldbeatKpiSlot;
  reportsWithParts: FieldbeatKpiSlot;
  recentActivity: FieldbeatKpiSlot;
}

const UNAVAILABLE_REASON = "Información todavía no disponible";

/**
 * @param kpis único parámetro - la firma en sí documenta que ningún slot
 * puede derivarse de un array de ranking top-10 (ver test dedicado).
 */
export function buildExecutiveSummary(kpis: FieldbeatKpis | null): FieldbeatExecutiveSummaryViewModel {
  return {
    totalReports: kpis
      ? { status: "available", label: "Reportes de terreno", value: kpis.total_fieldbeat_reports, hint: "total registrado", accent: "green" }
      : { status: "unavailable", label: "Reportes de terreno", reason: UNAVAILABLE_REASON, accent: "green" },

    // Requerirían COUNT(DISTINCT ...)/COUNT(*) reales que el contrato
    // actual no expone (solo top-10) - nunca `.length` de reportsByClient/
    // topEquipmentByParts. Backlog, no esta etapa.
    clientsWithActivity: { status: "unavailable", label: "Clientes con actividad", reason: UNAVAILABLE_REASON, accent: "default" },
    equipmentAttended: { status: "unavailable", label: "Equipos atendidos", reason: UNAVAILABLE_REASON, accent: "default" },
    // Requiere el campo task_type, ausente en los 5 result sets.
    predominantTaskType: { status: "unavailable", label: "Tipo de trabajo predominante", reason: UNAVAILABLE_REASON, accent: "default" },

    reportsWithParts: kpis
      ? {
          status: "available",
          label: "Reportes con repuesto registrado",
          value: kpis.reports_with_used_parts,
          hint: `${percentLabel(kpis.reports_with_used_parts, kpis.total_fieldbeat_reports)} del total`,
          accent: "purple"
        }
      : { status: "unavailable", label: "Reportes con repuesto registrado", reason: UNAVAILABLE_REASON, accent: "purple" },

    // Requiere un campo de recencia (fecha del reporte más nuevo por
    // cliente), ausente en los 5 result sets.
    recentActivity: { status: "unavailable", label: "Actividad más reciente", reason: UNAVAILABLE_REASON, accent: "dark" }
  };
}

export interface FieldbeatPartsPresenceViewModel {
  withParts: number;
  withoutParts: number;
  totalReports: number;
}

// "Presencia de repuesto en el reporte" (tarjeta secundaria del mockup) -
// 2 segmentos que suman total_fieldbeat_reports.
export function buildPartsPresence(kpis: FieldbeatKpis): FieldbeatPartsPresenceViewModel {
  return {
    withParts: kpis.reports_with_used_parts,
    withoutParts: kpis.total_fieldbeat_reports - kpis.reports_with_used_parts,
    totalReports: kpis.total_fieldbeat_reports
  };
}

export interface FieldbeatTicketLinkageViewModel {
  accessible: number;
  missingOrRestricted: number;
  noTicket: number;
  totalReports: number;
}

export function buildTicketLinkage(kpis: FieldbeatKpis): FieldbeatTicketLinkageViewModel {
  return {
    accessible: kpis.reports_linked_to_accessible_zendesk,
    missingOrRestricted: kpis.reports_linked_to_missing_or_restricted_zendesk,
    noTicket: kpis.reports_no_ticket_reported,
    totalReports: kpis.total_fieldbeat_reports
  };
}
