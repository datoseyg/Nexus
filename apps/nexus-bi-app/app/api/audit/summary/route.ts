import { NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import type { AuditSummary } from "@/types/audit";

export const runtime = "nodejs";

const REVIEW_REQUIRED_STATUSES = new Set(["HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"]);

// Alimenta: pestaña "Resumen de calidad" de /audit/manual-review, y el
// contador "Auditoría · N pendientes" del NavBar. Fuentes:
// gold.fieldbeat_data_quality (desglose por report_quality_status) +
// gold.scope_metadata (fila única con métricas de alcance) - ver
// docs/MANUAL_REVIEW_VIEW.md.
export async function GET() {
  try {
    const qualityRows = await runQuery<{
      report_quality_status: string;
      report_count: bigint;
      matched_used_parts_count: bigint;
      placeholder_used_parts_count: bigint;
      unmatched_used_parts_count: bigint;
      ambiguous_used_parts_count: bigint;
    }>(`SELECT * FROM gold.fieldbeat_data_quality`);

    let totalFieldbeatReports = 0;
    let reportsOk = 0;
    let reportsReviewRequired = 0;
    let partsMatched = 0;
    let partsPlaceholder = 0;
    let partsUnmatched = 0;
    let partsAmbiguous = 0;

    for (const row of qualityRows) {
      const count = Number(row.report_count);
      totalFieldbeatReports += count;
      if (row.report_quality_status === "OK") reportsOk += count;
      if (REVIEW_REQUIRED_STATUSES.has(row.report_quality_status)) reportsReviewRequired += count;
      partsMatched += Number(row.matched_used_parts_count);
      partsPlaceholder += Number(row.placeholder_used_parts_count);
      partsUnmatched += Number(row.unmatched_used_parts_count);
      partsAmbiguous += Number(row.ambiguous_used_parts_count);
    }

    const scopeRows = await runQuery<{
      zendesk_backfill_tickets_forbidden: bigint | null;
      fieldbeat_tasks_without_zendesk_ticket: bigint | null;
      fieldbeat_tasks_linked_to_missing_zendesk_ticket: bigint | null;
    }>(
      `SELECT zendesk_backfill_tickets_forbidden, fieldbeat_tasks_without_zendesk_ticket, fieldbeat_tasks_linked_to_missing_zendesk_ticket FROM gold.scope_metadata`
    );

    const scope = scopeRows[0];

    const summary: AuditSummary = {
      reportsOk,
      reportsReviewRequired,
      partsMatched,
      partsUnmatched,
      partsAmbiguous,
      partsPlaceholder,
      ticketsForbiddenPending: Number(scope?.zendesk_backfill_tickets_forbidden ?? 0),
      reportsNoTicket: Number(scope?.fieldbeat_tasks_without_zendesk_ticket ?? 0),
      reportsLinkedMissingOrRestricted: Number(scope?.fieldbeat_tasks_linked_to_missing_zendesk_ticket ?? 0),
      totalFieldbeatReports
    };

    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
