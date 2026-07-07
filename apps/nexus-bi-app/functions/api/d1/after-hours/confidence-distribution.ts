import { type Env, jsonResponse, errorResponse } from "../_shared";
import { buildConditions, parseAfterHoursFilters, CONFIDENCE_TIER_ORDER } from "./_filters";

const TABLE = "marts_fieldbeat_working_hours_analysis";

// GET /api/d1/after-hours/confidence-distribution - distribución
// Alta/Media/Baja/Insuficiente, equivalente D1 de
// /api/dashboard/after-hours/confidence-distribution. Ver
// docs/CLOUDFLARE_D1_MIGRATION.md y docs/CALCULATION_CONFIDENCE_MODEL.md.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const url = new URL(context.request.url);
    const filters = parseAfterHoursFilters(url);
    const { where, params } = buildConditions(filters);

    const result = await context.env.DB
      .prepare(`SELECT confidence_label, COUNT(*) AS task_count FROM ${TABLE} ${where} GROUP BY confidence_label`)
      .bind(...params)
      .all<{ confidence_label: string; task_count: number }>();

    const byLabel = new Map(result.results.map(row => [row.confidence_label, row.task_count]));

    // Se devuelven las 4 categorías siempre (aunque tengan 0 tareas), en
    // orden fijo Insuficiente->Alta - mismo idioma que el modo local-duckdb.
    const distribution = CONFIDENCE_TIER_ORDER.map(label => ({
      confidence_label: label,
      task_count: byLabel.get(label) ?? 0
    }));

    return jsonResponse({ rows: distribution });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
