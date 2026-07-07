import { type Env, jsonResponse, errorResponse } from "../_shared";

interface DataQualityRow {
  report_quality_status: string;
  report_count: number;
  matched_used_parts_count: number;
  placeholder_used_parts_count: number;
  unmatched_used_parts_count: number;
  ambiguous_used_parts_count: number;
}

const REVIEW_REQUIRED_STATUSES = new Set(["HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"]);

// GET /api/d1/audit/summary - equivalente D1 de /api/audit/summary en modo
// local-duckdb (misma forma de respuesta) - ver
// docs/CLOUDFLARE_D1_MIGRATION.md y docs/MANUAL_REVIEW_VIEW.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const qualityResult = await context.env.DB.prepare("SELECT * FROM gold_fieldbeat_data_quality").all<DataQualityRow>();

    let totalFieldbeatReports = 0;
    let reportsOk = 0;
    let reportsReviewRequired = 0;
    let partsMatched = 0;
    let partsPlaceholder = 0;
    let partsUnmatched = 0;
    let partsAmbiguous = 0;

    for (const row of qualityResult.results) {
      totalFieldbeatReports += row.report_count;
      if (row.report_quality_status === "OK") reportsOk += row.report_count;
      if (REVIEW_REQUIRED_STATUSES.has(row.report_quality_status)) reportsReviewRequired += row.report_count;
      partsMatched += row.matched_used_parts_count;
      partsPlaceholder += row.placeholder_used_parts_count;
      partsUnmatched += row.unmatched_used_parts_count;
      partsAmbiguous += row.ambiguous_used_parts_count;
    }

    const scopeResult = await context.env.DB
      .prepare(
        "SELECT zendesk_backfill_tickets_forbidden, fieldbeat_tasks_without_zendesk_ticket, fieldbeat_tasks_linked_to_missing_zendesk_ticket FROM gold_scope_metadata LIMIT 1"
      )
      .all<{
        zendesk_backfill_tickets_forbidden: number;
        fieldbeat_tasks_without_zendesk_ticket: number;
        fieldbeat_tasks_linked_to_missing_zendesk_ticket: number;
      }>();
    const scope = scopeResult.results[0];

    return jsonResponse({
      reportsOk,
      reportsReviewRequired,
      partsMatched,
      partsUnmatched,
      partsAmbiguous,
      partsPlaceholder,
      ticketsForbiddenPending: scope?.zendesk_backfill_tickets_forbidden ?? 0,
      reportsNoTicket: scope?.fieldbeat_tasks_without_zendesk_ticket ?? 0,
      reportsLinkedMissingOrRestricted: scope?.fieldbeat_tasks_linked_to_missing_zendesk_ticket ?? 0,
      totalFieldbeatReports
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
