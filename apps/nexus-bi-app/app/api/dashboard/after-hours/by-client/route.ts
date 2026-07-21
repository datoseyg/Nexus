import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, groupedAggregateSelectSql, mapGroupedRow, type GroupedAggregateQueryRow } from "@/lib/after-hours-metrics";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

export const runtime = "nodejs";

// "Top clientes por horas fuera de horario" - ver docs/AFTER_HOURS_METRICS.md.
// ETAPA 6.6C: fuente marts.fieldbeat_working_hours_analysis_current;
// poblaciones (total/calculable/contractual/legacy/none/fallback) y tasa
// SUM/SUM centralizadas en lib/after-hours-metrics.ts (§9/§13).
// ETAPA 6.6D: autoexcluye su propio filtro `client` (ver by-technician).
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [`w.client_name IS NOT NULL AND w.client_name != ''`, ...buildAfterHoursMartConditions(filters, "w", pusher, ["cliente"])];

    const rows = await runQuery<GroupedAggregateQueryRow & { client_rut: string | null }>(
      `
        SELECT
          w.client_name AS key,
          MAX(w.client_rut) AS client_rut,
          ${groupedAggregateSelectSql("w")}
        FROM ${AFTER_HOURS_VIEW} w
        WHERE ${conditions.join(" AND ")}
        GROUP BY w.client_name
        ORDER BY after_hours_minutes DESC NULLS LAST
      `,
      pusher.params
    );

    const mapped: AfterHoursByDimensionRow[] = rows.map(row => mapGroupedRow({ ...row, extra: row.client_rut }));

    return NextResponse.json({ rows: mapped });
  } catch (error) {
    return handleApiError(error);
  }
}
