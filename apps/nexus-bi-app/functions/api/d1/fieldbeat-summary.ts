import { type Env, jsonResponse, errorResponse } from "./_shared";

interface FieldbeatRow {
  fieldbeat_task_id: number;
  fieldbeat_task_date: string | null;
  client_name: string | null;
  task_type: string | null;
  task_state: string | null;
  used_parts_count: number | null;
  matched_used_parts_count: number | null;
  report_quality_status: string | null;
}

const TABLE = "marts_fieldbeat_report_dolibarr_operational_view";
const ROW_LIMIT = 100;

// "" / "all" / "todos" (cualquier capitalización) significa "sin filtro" -
// NUNCA debe llegar a un WHERE client_name = 'Todos' literal.
const ALL_SENTINELS = new Set(["", "all", "todos"]);
function isRealFilter(value: string): boolean {
  return !ALL_SENTINELS.has(value.trim().toLowerCase());
}

// GET /api/d1/fieldbeat-summary?client=&q=&from=&to= - equivalente D1 (en
// vivo, filtrable) de /api/dashboard/fieldbeat en modo local-duckdb. Ver
// docs/CLOUDFLARE_D1_MIGRATION.md.
//
// Todo el input de usuario (client/q/from/to) viaja por `.bind()` - nunca
// se interpola texto de usuario directo en el SQL, solo nombres de columna
// fijos escritos a mano en este archivo.
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const url = new URL(context.request.url);
    const client = url.searchParams.get("client")?.trim() ?? "";
    const q = url.searchParams.get("q")?.trim() ?? "";
    const from = url.searchParams.get("from")?.trim() ?? "";
    const to = url.searchParams.get("to")?.trim() ?? "";

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (isRealFilter(client)) {
      conditions.push("client_name = ?");
      params.push(client);
    }
    if (isRealFilter(q)) {
      const like = `%${q}%`;
      conditions.push("(client_name LIKE ? OR task_type LIKE ? OR report_quality_status LIKE ?)");
      params.push(like, like, like);
    }
    if (isRealFilter(from)) {
      conditions.push("fieldbeat_task_date >= ?");
      params.push(from);
    }
    if (isRealFilter(to)) {
      conditions.push("fieldbeat_task_date <= ?");
      params.push(to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rowsStatement = context.env.DB
      .prepare(
        `SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, task_state,
                used_parts_count, matched_used_parts_count, report_quality_status
         FROM ${TABLE}
         ${whereClause}
         ORDER BY fieldbeat_task_date DESC
         LIMIT ${ROW_LIMIT}`
      )
      .bind(...params);

    const aggregateStatement = context.env.DB
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(used_parts_count), 0) AS total_used_parts FROM ${TABLE} ${whereClause}`)
      .bind(...params);

    // Opciones del dropdown "Cliente": siempre sobre el universo completo
    // (sin los filtros actuales), para que no se vacíe a medida que el
    // usuario filtra - mismo criterio que /api/dashboard/operacional/filters
    // en modo local-duckdb.
    const clientOptionsStatement = context.env.DB.prepare(
      `SELECT DISTINCT client_name AS v FROM ${TABLE} WHERE client_name IS NOT NULL AND client_name != '' ORDER BY v LIMIT 200`
    );

    const [rowsResult, aggregateResult, clientOptionsResult] = await Promise.all([
      rowsStatement.all<FieldbeatRow>(),
      aggregateStatement.all<{ total: number; total_used_parts: number }>(),
      clientOptionsStatement.all<{ v: string }>()
    ]);

    return jsonResponse({
      source: "d1",
      data: rowsResult.results,
      meta: {
        total: aggregateResult.results[0]?.total ?? 0,
        totalUsedParts: aggregateResult.results[0]?.total_used_parts ?? 0,
        clientOptions: clientOptionsResult.results.map(r => r.v),
        filters: { client, q, from, to }
      }
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
