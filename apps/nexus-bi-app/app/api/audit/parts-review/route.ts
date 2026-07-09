import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildAuditMartConditions, createParamPusher, parseAuditFilters, round2, suggestAction } from "@/lib/audit-sql";
import type { PartsReviewRow } from "@/types/audit";

export const runtime = "nodejs";

// Alimenta: pestaña "Repuestos por revisar" de /audit/manual-review.
// Fuente: marts.used_parts_dolibarr_match + processed.fieldbeat_used_parts
// (cantidad) + marts.fieldbeat_report_dolibarr_operational_view (cliente,
// máquina, fecha) - ver docs/MANUAL_REVIEW_VIEW.md.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseAuditFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [
      `(m.needs_manual_review = true OR m.match_status IN ('NO_MATCH', 'AMBIGUOUS_MATCH', 'PLACEHOLDER_VALUE'))`,
      ...buildAuditMartConditions(filters, "r", pusher)
    ];

    if (filters.matchStatus) conditions.push(`m.match_status = ${pusher.push(filters.matchStatus)}`);
    if (filters.q) {
      const placeholder = pusher.push(`%${filters.q}%`);
      conditions.push(`(m.raw_part_identifier ILIKE ${placeholder} OR m.part_name ILIKE ${placeholder})`);
    }

    const baseFrom = `
      FROM marts.used_parts_dolibarr_match m
      LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
      LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
      WHERE ${conditions.join(" AND ")}
    `;

    const countRows = await runQuery<{ n: bigint }>(`SELECT COUNT(*) AS n ${baseFrom}`, pusher.params);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery<{
      used_part_id: string;
      fieldbeat_task_id: bigint;
      fieldbeat_task_date: string | null;
      client_name: string | null;
      equipment_internal_ids: string | null;
      raw_part_identifier: string | null;
      part_name: string | null;
      quantity: bigint | null;
      match_status: string;
      match_method: string | null;
      match_confidence: number | null;
      candidate_dolibarr_product_ids: string | null;
      dolibarr_ref: string | null;
      needs_manual_review: boolean;
    }>(
      `
        SELECT
          m.used_part_id,
          m.fieldbeat_task_id,
          r.fieldbeat_task_date,
          r.client_name,
          r.equipment_internal_ids,
          m.raw_part_identifier,
          m.part_name,
          p.quantity,
          m.match_status,
          m.match_method,
          m.match_confidence,
          m.candidate_dolibarr_product_ids,
          m.dolibarr_ref,
          m.needs_manual_review
        ${baseFrom}
        ORDER BY r.fieldbeat_task_date DESC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
    );

    const mapped: PartsReviewRow[] = rows.map(row => ({
      used_part_id: row.used_part_id,
      fieldbeat_task_id: Number(row.fieldbeat_task_id),
      fieldbeat_task_date: row.fieldbeat_task_date ? String(row.fieldbeat_task_date) : null,
      client_name: row.client_name,
      equipment_internal_ids: row.equipment_internal_ids,
      raw_part_identifier: row.raw_part_identifier,
      part_name: row.part_name,
      quantity: row.quantity === null ? null : Number(row.quantity),
      match_status: row.match_status,
      match_method: row.match_method,
      match_confidence: round2(row.match_confidence),
      candidate_dolibarr_product_ids: row.candidate_dolibarr_product_ids,
      dolibarr_ref: row.dolibarr_ref,
      needs_manual_review: Boolean(row.needs_manual_review),
      suggested_action: suggestAction(row.match_status, Boolean(row.needs_manual_review))
    }));

    return NextResponse.json({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
