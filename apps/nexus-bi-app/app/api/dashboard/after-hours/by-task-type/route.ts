import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { getConfidenceLabel } from "@/lib/confidence";
import type { AfterHoursByDimensionRow } from "@/types/after-hours";

// "Horas fuera de horario por tipo de tarea" - ver docs/AFTER_HOURS_METRICS.md.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [`w.task_type IS NOT NULL AND w.task_type != ''`, ...buildAfterHoursMartConditions(filters, "w", pusher)];

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
          w.task_type AS key,
          COALESCE(SUM(w.duration_minutes), 0) AS total_minutes,
          COALESCE(SUM(w.business_minutes), 0) AS business_minutes,
          COALESCE(SUM(w.after_hours_total_minutes), 0) AS after_hours_minutes,
          COUNT(*) AS tasks_total,
          COUNT(*) FILTER (WHERE w.is_after_hours_task = true) AS tasks_with_after_hours,
          SUM(w.confidence_score * w.duration_minutes) / NULLIF(SUM(w.duration_minutes), 0) AS confidence_weighted
        FROM marts.fieldbeat_working_hours_analysis w
        WHERE ${conditions.join(" AND ")}
        GROUP BY w.task_type
        ORDER BY after_hours_minutes DESC
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
