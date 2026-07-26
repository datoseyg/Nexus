// Vocabulario compartido que sobrevive al rediseño de Phase 3 (ver
// dead-code removal, §11): los tipos del viejo GET /api/dashboard/fieldbeat
// (5 agregados GOLD fijos, sin filtros), /activity y la barra de filtros
// vieja se eliminaron junto con esas rutas/componentes - sin consumidores
// tras el rediseño de 4 pestañas. Lo que queda acá es lo que SÍ sigue
// consumiéndose: lib/fieldbeat-invariants.ts (validación standalone,
// independiente de la UI) y lib/fieldbeat-quality-filters.ts (reutiliza el
// vocabulario de report_quality_status). El contrato de GET
// /api/dashboard/fieldbeat/detail (Reportes, deuda transitoria de Phase 3
// §10) se eliminó en Phase 4 junto con esa ruta y FieldbeatDetailTable.tsx
// - reemplazado por types/fieldbeat-reports.ts.

export interface FieldbeatKpis {
  total_fieldbeat_reports: number;
  reports_no_ticket_reported: number;
  reports_linked_to_accessible_zendesk: number;
  reports_linked_to_missing_or_restricted_zendesk: number;
  reports_with_used_parts: number;
  reports_ok: number;
  reports_review_required: number;
  total_used_parts: number;
  matched_used_parts: number;
  placeholder_used_parts: number;
  unmatched_used_parts: number;
  ambiguous_used_parts: number;
  zendesk_link_rate: string;
  used_parts_match_rate: string;
  review_required_rate: string;
}

// Vocabulario conocido de report_quality_status - invariante del dataset
// (ver lib/fieldbeat-invariants.ts), reutilizado por
// lib/fieldbeat-quality-filters.ts para el filtro qualityStatus.
export type KnownReportQualityStatus = "OK" | "NO_USED_PARTS" | "HAS_PLACEHOLDERS" | "HAS_UNMATCHED_PARTS" | "HAS_AMBIGUOUS_PARTS" | "REVIEW_REQUIRED";

export const KNOWN_REPORT_QUALITY_STATUSES: readonly KnownReportQualityStatus[] = [
  "OK",
  "NO_USED_PARTS",
  "HAS_PLACEHOLDERS",
  "HAS_UNMATCHED_PARTS",
  "HAS_AMBIGUOUS_PARTS",
  "REVIEW_REQUIRED"
];

export interface FieldbeatDataQualityRow {
  report_quality_status: string;
  report_count: number;
  percent_of_total_reports: string;
  used_parts_count: number;
  matched_used_parts_count: number;
  placeholder_used_parts_count: number;
  unmatched_used_parts_count: number;
  ambiguous_used_parts_count: number;
}
