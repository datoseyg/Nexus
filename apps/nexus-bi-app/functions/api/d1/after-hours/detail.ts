import { type Env, jsonResponse, errorResponse } from "../_shared";
import { buildConditions, parseAfterHoursFilters } from "./_filters";

const TABLE = "marts_fieldbeat_working_hours_analysis";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

function clampPageSize(requested: number): number {
  if (!requested || Number.isNaN(requested) || requested <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}
function clampPage(requested: number): number {
  if (!requested || Number.isNaN(requested) || requested < 1) return 1;
  return Math.floor(requested);
}

interface Row {
  fieldbeat_task_id: number;
  start_time_local: string | null;
  estimated_end_time_local: string | null;
  reported_end_raw: string | null;
  client_name: string | null;
  equipment_internal_ids: string | null;
  assigned_to: string | null;
  task_type: string | null;
  duration_minutes: number | null;
  business_minutes: number | null;
  after_hours_weekday_minutes: number | null;
  weekend_minutes: number | null;
  holiday_minutes: number | null;
  after_hours_rate: number | null;
  calculation_method: string;
  calculation_status: string;
  confidence_score: number | null;
  confidence_label: string | null;
  confidence_factors: string | null;
}

// GET /api/d1/after-hours/detail?page=&pageSize=&client=&... - tabla de
// detalle paginada, equivalente D1 de /api/dashboard/after-hours/detail. Ver
// docs/CLOUDFLARE_D1_MIGRATION.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const url = new URL(context.request.url);
    const page = clampPage(Number(url.searchParams.get("page")));
    const pageSize = clampPageSize(Number(url.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE);
    const filters = parseAfterHoursFilters(url);
    const { where, params } = buildConditions(filters);

    const countResult = await context.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM ${TABLE} ${where}`)
      .bind(...params)
      .all<{ n: number }>();
    const totalRows = countResult.results[0]?.n ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rowsResult = await context.env.DB
      .prepare(
        `SELECT
           fieldbeat_task_id, start_time_local, estimated_end_time_local, reported_end_raw,
           client_name, equipment_internal_ids, assigned_to, task_type,
           duration_minutes, business_minutes, after_hours_weekday_minutes, weekend_minutes,
           holiday_minutes, after_hours_rate, calculation_method, calculation_status,
           confidence_score, confidence_label, confidence_factors
         FROM ${TABLE}
         ${where}
         ORDER BY start_time_local DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, pageSize, offset)
      .all<Row>();

    const mapped = rowsResult.results.map(row => ({
      fieldbeat_task_id: row.fieldbeat_task_id,
      start_time: row.start_time_local,
      estimated_end_time: row.calculation_method === "EXACT_REPORTED_START_END" ? row.reported_end_raw : row.estimated_end_time_local,
      client_name: row.client_name,
      equipment_internal_ids: row.equipment_internal_ids,
      assigned_to: row.assigned_to,
      task_type: row.task_type,
      duration_hours: row.duration_minutes !== null ? row.duration_minutes / 60 : null,
      business_hours: row.business_minutes !== null ? row.business_minutes / 60 : null,
      after_hours: row.after_hours_weekday_minutes !== null ? row.after_hours_weekday_minutes / 60 : null,
      weekend_hours: row.weekend_minutes !== null ? row.weekend_minutes / 60 : null,
      holiday_hours: row.holiday_minutes !== null ? row.holiday_minutes / 60 : null,
      after_hours_rate: row.after_hours_rate,
      calculation_method: row.calculation_method,
      calculation_status: row.calculation_status,
      confidence_score: row.confidence_score,
      confidence_label: row.confidence_label,
      confidence_factors: row.confidence_factors
    }));

    return jsonResponse({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
