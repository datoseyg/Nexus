import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildAuditMartConditions, createParamPusher, parseAuditFilters } from "@/lib/audit-sql";
import type { TicketLinkReviewRow } from "@/types/audit";

// Alimenta: pestaña "Tickets faltantes o restringidos" de
// /audit/manual-review. Fuente:
// marts.fieldbeat_report_dolibarr_operational_view WHERE
// zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK' (920
// reportes reales — ver el 403 Forbidden documentado en CLAUDE.md §
// Pendientes conocidos para Fase 2). Ver docs/MANUAL_REVIEW_VIEW.md.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseAuditFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [`r.zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'`, ...buildAuditMartConditions(filters, "r", pusher)];

    if (filters.q) {
      const placeholder = pusher.push(`%${filters.q}%`);
      conditions.push(`(r.client_name ILIKE ${placeholder} OR r.equipment_internal_ids ILIKE ${placeholder} OR r.linked_zendesk_ticket_id ILIKE ${placeholder})`);
    }

    const baseFrom = `FROM marts.fieldbeat_report_dolibarr_operational_view r WHERE ${conditions.join(" AND ")}`;

    const countRows = await runQuery<{ n: bigint }>(`SELECT COUNT(*) AS n ${baseFrom}`, pusher.params);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery<{
      fieldbeat_task_id: bigint;
      fieldbeat_task_date: string | null;
      client_name: string | null;
      equipment_internal_ids: string | null;
      linked_zendesk_ticket_id: string | null;
      task_type: string | null;
      technician_names: string | null;
      used_parts_count: bigint;
      report_quality_status: string;
    }>(
      `
        SELECT
          r.fieldbeat_task_id, r.fieldbeat_task_date, r.client_name, r.equipment_internal_ids,
          r.linked_zendesk_ticket_id, r.task_type, r.technician_names, r.used_parts_count, r.report_quality_status
        ${baseFrom}
        ORDER BY r.fieldbeat_task_date DESC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
    );

    const mapped: TicketLinkReviewRow[] = rows.map(row => ({
      fieldbeat_task_id: Number(row.fieldbeat_task_id),
      fieldbeat_task_date: row.fieldbeat_task_date ? String(row.fieldbeat_task_date) : null,
      client_name: row.client_name,
      equipment_internal_ids: row.equipment_internal_ids,
      linked_zendesk_ticket_id: row.linked_zendesk_ticket_id,
      task_type: row.task_type,
      technician_names: row.technician_names,
      used_parts_count: Number(row.used_parts_count),
      report_quality_status: row.report_quality_status
    }));

    return NextResponse.json({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
