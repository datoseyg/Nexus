import { KNOWN_REPORT_QUALITY_STATUSES } from "@/types/fieldbeat";
import type { FieldbeatDataQualityRow, FieldbeatKpis } from "@/types/fieldbeat";

// ETAPA 5 - invariantes del dataset FieldBeat. Verificadas en dos niveles,
// nunca mezclados: tests unitarios con fixtures sintéticos (este módulo,
// caso sano + caso roto) y certificación aparte contra datos reales (ver
// reporte final: UNIT_INVARIANTS_PASS vs REAL_DATA_INVARIANTS_PASS). Nunca
// se oculta una discrepancia con redondeo - cada función reporta la cifra
// real encontrada además del booleano `holds`.

export interface TicketLinkageInvariantResult {
  holds: boolean;
  accessible: number;
  missingOrRestricted: number;
  noTicket: number;
  sum: number;
  totalReports: number;
}

// Invariante #1: reports_linked_to_accessible_zendesk +
// reports_linked_to_missing_or_restricted_zendesk + reports_no_ticket_reported === total_fieldbeat_reports.
export function checkTicketLinkageInvariant(kpis: FieldbeatKpis): TicketLinkageInvariantResult {
  const accessible = kpis.reports_linked_to_accessible_zendesk;
  const missingOrRestricted = kpis.reports_linked_to_missing_or_restricted_zendesk;
  const noTicket = kpis.reports_no_ticket_reported;
  const sum = accessible + missingOrRestricted + noTicket;

  return { holds: sum === kpis.total_fieldbeat_reports, accessible, missingOrRestricted, noTicket, sum, totalReports: kpis.total_fieldbeat_reports };
}

export interface DataQualitySumInvariantResult {
  holds: boolean;
  sum: number;
  totalReports: number;
  canonicalPresent: string[];
  canonicalMissing: string[];
  unknownPresent: string[];
  duplicated: string[];
}

// Invariante #2: SUM(dataQuality.report_count) === total_fieldbeat_reports,
// solo estrictamente significativa cuando las 6 categorías canónicas están
// presentes, sin duplicados. `holds` refleja únicamente la suma (el
// reclamo real de la invariante); canonicalMissing/unknownPresent/
// duplicated se reportan por separado, nunca ocultos. Una categoría
// desconocida SIGUE sumando - nunca se descarta en silencio. Una categoría
// duplicada nunca se suma/sobrescribe como si el contrato fuera correcto:
// ambas filas se cuentan tal cual llegaron, y la duplicidad se reporta
// explícitamente.
export function checkDataQualitySumInvariant(dataQuality: FieldbeatDataQualityRow[], totalReports: number): DataQualitySumInvariantResult {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const row of dataQuality) {
    if (seen.has(row.report_quality_status)) duplicated.push(row.report_quality_status);
    seen.add(row.report_quality_status);
  }

  const sum = dataQuality.reduce((acc, row) => acc + row.report_count, 0);
  const canonicalSet = KNOWN_REPORT_QUALITY_STATUSES as readonly string[];
  const canonicalPresent = canonicalSet.filter(status => seen.has(status));
  const canonicalMissing = canonicalSet.filter(status => !seen.has(status));
  const unknownPresent = [...seen].filter(status => !canonicalSet.includes(status));

  return { holds: sum === totalReports, sum, totalReports, canonicalPresent, canonicalMissing, unknownPresent, duplicated };
}

export interface UsedPartsSumInvariantResult {
  holds: boolean;
  sum: number;
  totalUsedParts: number;
}

// Invariante #3: matched_used_parts + placeholder_used_parts +
// unmatched_used_parts + ambiguous_used_parts contra total_used_parts -
// nunca asumida igual sin comprobarla, se reporta la cifra real de ambos
// lados.
export function checkUsedPartsSumInvariant(kpis: FieldbeatKpis): UsedPartsSumInvariantResult {
  const sum = kpis.matched_used_parts + kpis.placeholder_used_parts + kpis.unmatched_used_parts + kpis.ambiguous_used_parts;
  return { holds: sum === kpis.total_used_parts, sum, totalUsedParts: kpis.total_used_parts };
}

export interface ReportsOkInvariantResult {
  applicable: boolean;
  holds: boolean;
  reportsOk: number;
  dataQualityOkCount: number | null;
}

// Invariante #4: reports_ok === dataQuality[OK].report_count, solo cuando
// OK está presente en dataQuality. Si no está presente, `applicable=false`
// - nunca se declara `holds=true` como si se hubiera verificado algo que
// en realidad no se pudo comprobar.
export function checkReportsOkInvariant(kpis: FieldbeatKpis, dataQuality: FieldbeatDataQualityRow[]): ReportsOkInvariantResult {
  const okRow = dataQuality.find(row => row.report_quality_status === "OK");

  if (!okRow) {
    return { applicable: false, holds: false, reportsOk: kpis.reports_ok, dataQualityOkCount: null };
  }

  return { applicable: true, holds: kpis.reports_ok === okRow.report_count, reportsOk: kpis.reports_ok, dataQualityOkCount: okRow.report_count };
}
