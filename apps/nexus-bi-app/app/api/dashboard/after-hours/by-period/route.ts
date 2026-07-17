import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, groupedAggregateSelectSql, mapGroupedRow, type GroupedAggregateQueryRow } from "@/lib/after-hours-metrics";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

export const runtime = "nodejs";

// "Horas fuera de horario por mes" - ver docs/AFTER_HOURS_METRICS.md.
// Período derivado de start_time_local (ya en hora de Chile), con
// "(sin fecha)" para tareas con start_time inválido - mismo idioma que
// toPeriod() en src/gold/build-fieldbeat-gold.js. ETAPA 6.6C: fuente
// marts.fieldbeat_working_hours_analysis_current.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<GroupedAggregateQueryRow>(
      `
        SELECT
          COALESCE(TO_CHAR(w.start_time_local, 'YYYY-MM'), '(sin fecha)') AS key,
          ${groupedAggregateSelectSql("w")}
        FROM ${AFTER_HOURS_VIEW} w
        ${whereClause}
        GROUP BY 1
        ORDER BY 1
      `,
      pusher.params
    );

    const mapped: AfterHoursByDimensionRow[] = rows.map(row => mapGroupedRow(row));

    return NextResponse.json({ rows: mapped });
  } catch (error) {
    return handleApiError(error);
  }
}
