import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildAuditMartConditions, createParamPusher, parseAuditFilters } from "@/lib/audit-sql";
import type { AmbiguousPartRow } from "@/types/audit";

export const runtime = "nodejs";

// Alimenta: pestaña "Matches ambiguos" de /audit/manual-review. Fuente:
// marts.used_parts_dolibarr_match WHERE match_status = 'AMBIGUOUS_MATCH',
// agrupado por raw_part_identifier - ver docs/MANUAL_REVIEW_VIEW.md.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseAuditFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [`m.match_status = 'AMBIGUOUS_MATCH'`, ...buildAuditMartConditions(filters, "r", pusher)];

    if (filters.q) {
      const placeholder = pusher.push(`%${filters.q}%`);
      conditions.push(`(m.raw_part_identifier ILIKE ${placeholder} OR m.part_name ILIKE ${placeholder})`);
    }

    const baseFrom = `
      FROM marts.used_parts_dolibarr_match m
      LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
      WHERE ${conditions.join(" AND ")}
    `;

    const countRows = await runQuery<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM (SELECT m.raw_part_identifier ${baseFrom} GROUP BY m.raw_part_identifier) t`,
      pusher.params
    );
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery<{
      raw_part_identifier: string;
      part_name: string | null;
      candidate_dolibarr_product_ids: string | null;
      occurrences: bigint;
      clientes_afectados: bigint;
      equipos_afectados: bigint;
    }>(
      `
        SELECT
          m.raw_part_identifier,
          MAX(m.part_name) AS part_name,
          MAX(m.candidate_dolibarr_product_ids) AS candidate_dolibarr_product_ids,
          COUNT(*) AS occurrences,
          COUNT(DISTINCT r.client_name) AS clientes_afectados,
          COUNT(DISTINCT r.equipment_internal_ids) AS equipos_afectados
        ${baseFrom}
        GROUP BY m.raw_part_identifier
        ORDER BY occurrences DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
    );

    const mapped: AmbiguousPartRow[] = rows.map(row => ({
      raw_part_identifier: row.raw_part_identifier,
      part_name: row.part_name,
      candidate_dolibarr_product_ids: row.candidate_dolibarr_product_ids,
      occurrences: Number(row.occurrences),
      clientes_afectados: Number(row.clientes_afectados),
      equipos_afectados: Number(row.equipos_afectados)
    }));

    return NextResponse.json({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
