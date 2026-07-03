import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildAuditMartConditions, createParamPusher, parseAuditFilters } from "@/lib/audit-sql";
import type { PlaceholderGroupRow } from "@/types/audit";

// Alimenta: pestaña "Placeholders / valores no informativos" de
// /audit/manual-review. Fuente: marts.used_parts_dolibarr_match WHERE
// match_status = 'PLACEHOLDER_VALUE', agrupado por
// UPPER(TRIM(raw_part_identifier)) para consolidar variantes de
// mayúsculas/espacios del mismo valor basura (ej. "N/A" vs "n/a") — ver
// docs/MANUAL_REVIEW_VIEW.md. Objetivo: detectar los valores basura más
// frecuentes (N/A, NO HAY, S/N, --, etc.), no inventar una lista fija.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseAuditFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [`m.match_status = 'PLACEHOLDER_VALUE'`, ...buildAuditMartConditions(filters, "r", pusher)];

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
      `SELECT COUNT(*) AS n FROM (SELECT UPPER(TRIM(m.raw_part_identifier)) AS k ${baseFrom} GROUP BY k) t`,
      pusher.params
    );
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery<{ raw_part_identifier: string; part_name_sample: string | null; occurrences: bigint }>(
      `
        SELECT
          MAX(m.raw_part_identifier) AS raw_part_identifier,
          MAX(m.part_name) AS part_name_sample,
          COUNT(*) AS occurrences
        ${baseFrom}
        GROUP BY UPPER(TRIM(m.raw_part_identifier))
        ORDER BY occurrences DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
    );

    const mapped: PlaceholderGroupRow[] = rows.map(row => ({
      raw_part_identifier: row.raw_part_identifier,
      part_name_sample: row.part_name_sample,
      occurrences: Number(row.occurrences)
    }));

    return NextResponse.json({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
