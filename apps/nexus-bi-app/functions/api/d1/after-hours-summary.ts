import { type Env, jsonResponse, errorResponse } from "./_shared";

// GET /api/d1/after-hours-summary - equivalente D1 (agregado fijo, sin
// filtros cruzados) de /api/dashboard/after-hours/summary en modo
// local-duckdb. Ver docs/CLOUDFLARE_D1_MIGRATION.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const kpis = await context.env.DB.prepare("SELECT * FROM gold_after_hours_work_analysis LIMIT 1").all();

    const byClient = await context.env.DB
      .prepare(
        `SELECT client_name, total_hours, after_hours_total_hours, after_hours_rate, tasks_total, tasks_with_after_hours
         FROM gold_after_hours_by_client
         ORDER BY total_hours DESC
         LIMIT 15`
      )
      .all();

    return jsonResponse({
      kpis: kpis.results[0] ?? null,
      byClient: byClient.results
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
