// Forma NORMALIZADA de GET /api/dashboard/fieldbeat (route.ts sin cambios
// funcionales, 5 queries fijas, sin filtros). La respuesta HTTP real trae
// todo campo numérico como string decimal (columnas BIGINT de Postgres,
// nunca coercionadas por la ruta) - lib/fieldbeat-contract.ts::
// parseFieldbeatDashboardResponse() es el único lugar que convierte esos
// strings a number; estos tipos describen el contrato YA normalizado que
// consume el resto de la app (componentes/hooks nunca ven el string crudo).
// Fuente verificada: src/gold/build-fieldbeat-gold.js.

export interface FieldbeatKpis {
  total_fieldbeat_reports: number;
  reports_no_ticket_reported: number;
  reports_linked_to_accessible_zendesk: number;
  reports_linked_to_missing_or_restricted_zendesk: number;
  reports_with_used_parts: number;
  reports_ok: number;
  // Definición ANCHA: reportes con >=1 repuesto needs_manual_review. NO es
  // lo mismo que dataQuality[REVIEW_REQUIRED].report_count (match exacto
  // de status, más angosto) - ver src/gold/build-fieldbeat-gold.js.
  // Deliberadamente NO usado en la grilla de KPI (ver lib/fieldbeat-metrics.ts).
  reports_review_required: number;
  total_used_parts: number;
  matched_used_parts: number;
  placeholder_used_parts: number;
  unmatched_used_parts: number;
  ambiguous_used_parts: number;
  // Pre-formateados en el build (2 decimales, formato en-US "7.74%").
  // Nunca se renderizan directo - solo para comprobación de consistencia
  // en tests contra el porcentaje recalculado (lib/fieldbeat-metrics.ts).
  zendesk_link_rate: string;
  used_parts_match_rate: string;
  // OJO: numerador/denominador son de REPUESTOS, no de reportes.
  review_required_rate: string;
}

// Vocabulario conocido de report_quality_status - usado SOLO por la capa
// de presentación (lib/fieldbeat-data-quality-view.ts) para decidir cuándo
// reutilizar reportQualityBadge(). El contrato de transporte (parser) NO
// exige que report_quality_status sea uno de estos 6 valores - eso es una
// invariante del dataset, no un requisito estructural (ver
// lib/fieldbeat-invariants.ts).
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

export interface FieldbeatClientReportRow {
  client_name: string;
  total_reports: number;
}

export interface FieldbeatClientPartsRow {
  client_name: string;
  used_parts_count: number;
}

export interface FieldbeatEquipmentPartsRow {
  equipment_internal_id: string;
  used_parts_count: number;
}

export interface FieldbeatDashboardResponse {
  kpis: FieldbeatKpis | null;
  dataQuality: FieldbeatDataQualityRow[];
  reportsByClient: FieldbeatClientReportRow[];
  partsConsumptionByClient: FieldbeatClientPartsRow[];
  topEquipmentByParts: FieldbeatEquipmentPartsRow[];
}
