import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, groupedAggregateSelectSql, mapGroupedRow, type GroupedAggregateQueryRow } from "@/lib/after-hours-metrics";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

export const runtime = "nodejs";

// "Horas fuera de horario por tipo de tarea" - ver docs/AFTER_HOURS_METRICS.md.
// ETAPA 6.6C: fuente marts.fieldbeat_working_hours_analysis_current.
// ETAPA 6.6D: autoexcluye su propio filtro `taskType` (ver by-technician).
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [`w.task_type IS NOT NULL AND w.task_type != ''`, ...buildAfterHoursMartConditions(filters, "w", pusher, ["tipoTarea"])];

    const rows = await runQuery<GroupedAggregateQueryRow>(
      `
        SELECT
          w.task_type AS key,
          ${groupedAggregateSelectSql("w")}
        FROM ${AFTER_HOURS_VIEW} w
        WHERE ${conditions.join(" AND ")}
        GROUP BY w.task_type
        ORDER BY after_hours_minutes DESC NULLS LAST
      `,
      pusher.params
    );

    const mapped: AfterHoursByDimensionRow[] = rows.map(row => mapGroupedRow(row));

    return NextResponse.json({ rows: mapped });
  } catch (error) {
    return handleApiError(error);
  }
}
