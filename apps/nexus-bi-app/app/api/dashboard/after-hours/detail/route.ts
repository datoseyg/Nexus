import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import type { AfterHoursDetailRow } from "@/types/after-hours";

// Tabla de detalle de /dashboard/after-hours - clon estructural de
// /api/audit/parts-review/route.ts. Fuente: marts.fieldbeat_working_hours_analysis
// (nunca las tablas GOLD). Ver docs/AFTER_HOURS_METRICS.md.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const baseFrom = `FROM marts.fieldbeat_working_hours_analysis w ${whereClause}`;

    const countRows = await runQuery<{ n: bigint }>(`SELECT COUNT(*) AS n ${baseFrom}`, pusher.params);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery<{
      fieldbeat_task_id: bigint;
      start_time_local: string | null;
      estimated_end_time_local: string | null;
      reported_end_raw: string | null;
      client_name: string | null;
      equipment_internal_ids: string | null;
      assigned_to: string | null;
      task_type: string | null;
      duration_minutes: bigint | null;
      business_minutes: bigint | null;
      after_hours_weekday_minutes: bigint | null;
      weekend_minutes: bigint | null;
      holiday_minutes: bigint | null;
      after_hours_rate: number | null;
      calculation_method: string;
      calculation_status: string;
      confidence_score: bigint | null;
      confidence_label: string | null;
      confidence_factors: string | null;
    }>(
      `
        SELECT
          w.fieldbeat_task_id,
          w.start_time_local,
          w.estimated_end_time_local,
          w.reported_end_raw,
          w.client_name,
          w.equipment_internal_ids,
          w.assigned_to,
          w.task_type,
          w.duration_minutes,
          w.business_minutes,
          w.after_hours_weekday_minutes,
          w.weekend_minutes,
          w.holiday_minutes,
          w.after_hours_rate,
          w.calculation_method,
          w.calculation_status,
          w.confidence_score,
          w.confidence_label,
          w.confidence_factors
        ${baseFrom}
        ORDER BY w.start_time_local DESC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
    );

    const mapped: AfterHoursDetailRow[] = rows.map(row => ({
      fieldbeat_task_id: Number(row.fieldbeat_task_id),
      start_time: row.start_time_local ? String(row.start_time_local) : null,
      estimated_end_time:
        row.calculation_method === "EXACT_REPORTED_START_END"
          ? row.reported_end_raw
          : row.estimated_end_time_local
            ? String(row.estimated_end_time_local)
            : null,
      client_name: row.client_name,
      equipment_internal_ids: row.equipment_internal_ids,
      assigned_to: row.assigned_to,
      task_type: row.task_type,
      duration_hours: row.duration_minutes !== null ? Number(row.duration_minutes) / 60 : null,
      business_hours: row.business_minutes !== null ? Number(row.business_minutes) / 60 : null,
      after_hours: row.after_hours_weekday_minutes !== null ? Number(row.after_hours_weekday_minutes) / 60 : null,
      weekend_hours: row.weekend_minutes !== null ? Number(row.weekend_minutes) / 60 : null,
      holiday_hours: row.holiday_minutes !== null ? Number(row.holiday_minutes) / 60 : null,
      after_hours_rate: row.after_hours_rate,
      calculation_method: row.calculation_method,
      calculation_status: row.calculation_status,
      confidence_score: row.confidence_score !== null ? Number(row.confidence_score) : null,
      confidence_label: row.confidence_label,
      confidence_factors: row.confidence_factors
    }));

    return NextResponse.json({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
