import { type Env, jsonResponse, errorResponse } from "../_shared";
import { buildConditions, parseAfterHoursFilters, getConfidenceLabel } from "./_filters";

const TABLE = "marts_fieldbeat_working_hours_analysis";

interface Row {
  key: string;
  client_rut: string | null;
  total_minutes: number;
  business_minutes: number;
  after_hours_minutes: number;
  tasks_total: number;
  tasks_with_after_hours: number;
  confidence_weighted: number | null;
}

// GET /api/d1/after-hours/by-client - "Top clientes por horas fuera de
// horario", equivalente D1 de /api/dashboard/after-hours/by-client. Ver
// docs/CLOUDFLARE_D1_MIGRATION.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const url = new URL(context.request.url);
    const filters = parseAfterHoursFilters(url);
    const { where, params } = buildConditions(filters, ["client_name IS NOT NULL AND client_name != ''"]);

    const result = await context.env.DB
      .prepare(
        `SELECT
           client_name AS key,
           MAX(client_rut) AS client_rut,
           COALESCE(SUM(duration_minutes), 0) AS total_minutes,
           COALESCE(SUM(business_minutes), 0) AS business_minutes,
           COALESCE(SUM(after_hours_total_minutes), 0) AS after_hours_minutes,
           COUNT(*) AS tasks_total,
           SUM(CASE WHEN is_after_hours_task = 1 THEN 1 ELSE 0 END) AS tasks_with_after_hours,
           SUM(confidence_score * duration_minutes) / NULLIF(SUM(duration_minutes), 0) AS confidence_weighted
         FROM ${TABLE}
         ${where}
         GROUP BY client_name
         ORDER BY after_hours_minutes DESC`
      )
      .bind(...params)
      .all<Row>();

    const mapped = result.results.map(row => {
      const totalMinutes = row.total_minutes;
      const afterHoursMinutes = row.after_hours_minutes;
      const score = Math.round(row.confidence_weighted ?? 0);
      return {
        key: row.key,
        extra: row.client_rut,
        total_hours: Math.round((totalMinutes / 60) * 100) / 100,
        business_hours: Math.round((row.business_minutes / 60) * 100) / 100,
        after_hours_total_hours: Math.round((afterHoursMinutes / 60) * 100) / 100,
        after_hours_rate: totalMinutes > 0 ? afterHoursMinutes / totalMinutes : 0,
        tasks_total: row.tasks_total,
        tasks_with_after_hours: row.tasks_with_after_hours,
        confidence_score: score,
        confidence_label: getConfidenceLabel(score).label
      };
    });

    return jsonResponse({ rows: mapped });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
