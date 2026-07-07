import { type Env, jsonResponse, errorResponse } from "./_shared";

// GET /api/d1/fieldbeat-summary - snapshot fijo de
// gold_fieldbeat_report_analysis (equivalente D1 de /api/dashboard/fieldbeat
// en modo local-duckdb). Ver docs/CLOUDFLARE_D1_MIGRATION.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const result = await context.env.DB.prepare("SELECT * FROM gold_fieldbeat_report_analysis LIMIT 1").all();
    return jsonResponse({ summary: result.results[0] ?? null });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
