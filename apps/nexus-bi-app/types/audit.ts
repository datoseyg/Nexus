// Formas compartidas de request/response de /api/audit/* — ver
// docs/MANUAL_REVIEW_VIEW.md. Todo lo que aparece acá viene de una
// columna real del warehouse; nada es inventado ni un placeholder de UI.

export interface PaginatedResponse<T> {
  rows: T[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface AuditSummary {
  reportsOk: number;
  reportsReviewRequired: number;
  partsMatched: number;
  partsUnmatched: number;
  partsAmbiguous: number;
  partsPlaceholder: number;
  ticketsForbiddenPending: number;
  reportsNoTicket: number;
  reportsLinkedMissingOrRestricted: number;
  totalFieldbeatReports: number;
}

export interface PartsReviewRow {
  used_part_id: string;
  fieldbeat_task_id: number;
  fieldbeat_task_date: string | null;
  client_name: string | null;
  equipment_internal_ids: string | null;
  raw_part_identifier: string | null;
  part_name: string | null;
  quantity: number | null;
  match_status: string;
  match_method: string | null;
  match_confidence: number | null;
  candidate_dolibarr_product_ids: string | null;
  dolibarr_ref: string | null;
  needs_manual_review: boolean;
  suggested_action: string;
}

export interface AmbiguousPartRow {
  raw_part_identifier: string;
  part_name: string | null;
  candidate_dolibarr_product_ids: string | null;
  occurrences: number;
  clientes_afectados: number;
  equipos_afectados: number;
}

export interface PlaceholderGroupRow {
  raw_part_identifier: string;
  part_name_sample: string | null;
  occurrences: number;
}

export interface ReportReviewRow {
  fieldbeat_task_id: number;
  fieldbeat_task_date: string | null;
  client_name: string | null;
  equipment_internal_ids: string | null;
  task_type: string | null;
  technician_names: string | null;
  used_parts_count: number;
  review_required_used_parts_count: number;
  report_quality_status: string;
  linked_zendesk_ticket_id: string | null;
  zendesk_join_status: string;
}

export interface TicketLinkReviewRow {
  fieldbeat_task_id: number;
  fieldbeat_task_date: string | null;
  client_name: string | null;
  equipment_internal_ids: string | null;
  linked_zendesk_ticket_id: string | null;
  task_type: string | null;
  technician_names: string | null;
  used_parts_count: number;
  report_quality_status: string;
}
