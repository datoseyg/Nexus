import { type Env, jsonResponse, errorResponse } from "./_shared";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// GET /api/d1/parts-review?q=<texto>&limit=<n>&offset=<n> - equivalente D1
// (de solo lectura) de la pestaña "Repuestos por revisar" /
// "Matches ambiguos" de /audit/manual-review en modo local-duckdb. Ver
// docs/CLOUDFLARE_D1_MIGRATION.md y docs/MANUAL_REVIEW_VIEW.md.
//
// Único endpoint del set que recibe input del usuario (query string) -
// SIEMPRE va por `.bind()`, nunca por interpolación de string en el SQL.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const url = new URL(context.request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

    const baseCondition = "(needs_manual_review = 1 OR match_status IN ('AMBIGUOUS', 'UNMATCHED'))";
    const searchCondition = q ? " AND (part_name LIKE ?1 OR dolibarr_ref LIKE ?1 OR raw_part_identifier LIKE ?1)" : "";
    const searchParam = `%${q}%`;

    const countStatement = q
      ? context.env.DB.prepare(`SELECT COUNT(*) AS n FROM marts_used_parts_dolibarr_match WHERE ${baseCondition}${searchCondition}`).bind(searchParam)
      : context.env.DB.prepare(`SELECT COUNT(*) AS n FROM marts_used_parts_dolibarr_match WHERE ${baseCondition}`);

    const rowsStatement = q
      ? context.env.DB
          .prepare(
            `SELECT used_part_id, fieldbeat_task_id, part_name, raw_part_identifier, normalized_part_identifier,
                    dolibarr_ref, match_method, match_confidence, match_status, needs_manual_review
             FROM marts_used_parts_dolibarr_match
             WHERE ${baseCondition}${searchCondition}
             ORDER BY fieldbeat_task_id
             LIMIT ?2 OFFSET ?3`
          )
          .bind(searchParam, limit, offset)
      : context.env.DB
          .prepare(
            `SELECT used_part_id, fieldbeat_task_id, part_name, raw_part_identifier, normalized_part_identifier,
                    dolibarr_ref, match_method, match_confidence, match_status, needs_manual_review
             FROM marts_used_parts_dolibarr_match
             WHERE ${baseCondition}
             ORDER BY fieldbeat_task_id
             LIMIT ?1 OFFSET ?2`
          )
          .bind(limit, offset);

    const [countResult, rowsResult] = await Promise.all([countStatement.all<{ n: number }>(), rowsStatement.all()]);

    return jsonResponse({
      rows: rowsResult.results,
      totalRows: countResult.results[0]?.n ?? 0,
      limit,
      offset
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
