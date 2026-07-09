import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { getConfidenceLabel } from "@/lib/confidence";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

export const runtime = "nodejs";

// "Horas fuera de horario por mes" - ver docs/AFTER_HOURS_METRICS.md.
// Período derivado de start_time_local (ya en hora de Chile), con
// "(sin fecha)" para tareas con start_time inválido - mismo idioma que
// toPeriod() en src/gold/build-fieldbeat-gold.js.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<{
      key: string;
      total_minutes: number | bigint;
      business_minutes: number | bigint;
      after_hours_minutes: number | bigint;
      tasks_total: bigint;
      tasks_with_after_hours: bigint;
      confidence_weighted: number | null;
    }>(
      `
        SELECT
          COALESCE(TO_CHAR(w.start_time_local, 'YYYY-MM'), '(sin fecha)') AS key,
          COALESCE(SUM(w.duration_minutes), 0) AS total_minutes,
          COALESCE(SUM(w.business_minutes), 0) AS business_minutes,
          COALESCE(SUM(w.after_hours_total_minutes), 0) AS after_hours_minutes,
          COUNT(*) AS tasks_total,
          COUNT(*) FILTER (WHERE w.is_after_hours_task = true) AS tasks_with_after_hours,
          SUM(w.confidence_score * w.duration_minutes) / NULLIF(SUM(w.duration_minutes), 0) AS confidence_weighted
        FROM marts.fieldbeat_working_hours_analysis w
        ${whereClause}
        GROUP BY 1
        ORDER BY 1
      `,
      pusher.params
    );

    const mapped: AfterHoursByDimensionRow[] = rows.map(row => {
      const totalMinutes = Number(row.total_minutes);
      const afterHoursMinutes = Number(row.after_hours_minutes);
      const score = Math.round(Number(row.confidence_weighted ?? 0));
      return {
        key: row.key,
        total_hours: Math.round((totalMinutes / 60) * 100) / 100,
        business_hours: Math.round((Number(row.business_minutes) / 60) * 100) / 100,
        after_hours_total_hours: Math.round((afterHoursMinutes / 60) * 100) / 100,
        after_hours_rate: totalMinutes > 0 ? afterHoursMinutes / totalMinutes : 0,
        tasks_total: Number(row.tasks_total),
        tasks_with_after_hours: Number(row.tasks_with_after_hours),
        confidence_score: score,
        confidence_label: getConfidenceLabel(score).label
      };
    });

    return NextResponse.json({ rows: mapped });
  } catch (error) {
    return handleApiError(error);
  }
}
