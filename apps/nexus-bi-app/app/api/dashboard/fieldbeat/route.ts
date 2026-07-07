import { NextRequest, NextResponse } from "next/server";
import type { DuckDBValue } from "@duckdb/node-api";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";

const TABLE = "marts.fieldbeat_report_dolibarr_operational_view";
const ROW_LIMIT = 100;

// "" / "all" / "todos" (cualquier capitalización) significa "sin filtro" -
// NUNCA debe llegar a un WHERE client_name = 'Todos' literal. Mismo
// criterio que functions/api/d1/fieldbeat-summary.ts (misma forma de
// respuesta en los dos modos, ver lib/data-client.ts).
const ALL_SENTINELS = new Set(["", "all", "todos"]);
function isRealFilter(value: string): boolean {
  return !ALL_SENTINELS.has(value.trim().toLowerCase());
}

// Alimenta /dashboard/fieldbeat vía lib/data-client.ts::getFieldbeatSummary().
// Mismo contrato { source, data, meta } que la Pages Function D1 equivalente
// - ver docs/CLOUDFLARE_D1_MIGRATION.md. Todo el input de usuario
// (client/q/from/to) viaja parametrizado ($1, $2, ...), nunca interpolado
// directo en el SQL.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const client = searchParams.get("client")?.trim() ?? "";
    const q = searchParams.get("q")?.trim() ?? "";
    const from = searchParams.get("from")?.trim() ?? "";
    const to = searchParams.get("to")?.trim() ?? "";

    const conditions: string[] = [];
    const params: DuckDBValue[] = [];
    let paramIndex = 0;
    const push = (value: DuckDBValue): string => {
      params.push(value);
      paramIndex += 1;
      return `$${paramIndex}`;
    };

    if (isRealFilter(client)) {
      conditions.push(`client_name = ${push(client)}`);
    }
    if (isRealFilter(q)) {
      const like = `%${q}%`;
      const placeholder = push(like);
      conditions.push(`(client_name ILIKE ${placeholder} OR task_type ILIKE ${placeholder} OR report_quality_status ILIKE ${placeholder})`);
    }
    if (isRealFilter(from)) {
      conditions.push(`CAST(fieldbeat_task_date AS DATE) >= CAST(${push(from)} AS DATE)`);
    }
    if (isRealFilter(to)) {
      conditions.push(`CAST(fieldbeat_task_date AS DATE) <= CAST(${push(to)} AS DATE)`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery(
      `
        SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, task_state,
               used_parts_count, matched_used_parts_count, report_quality_status
        FROM ${TABLE}
        ${whereClause}
        ORDER BY fieldbeat_task_date DESC
        LIMIT ${ROW_LIMIT}
      `,
      params
    );

    const aggregateRows = await runQuery<{ total: bigint; total_used_parts: bigint }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(used_parts_count), 0) AS total_used_parts FROM ${TABLE} ${whereClause}`,
      params
    );

    // Opciones del dropdown "Cliente": siempre sobre el universo completo -
    // mismo criterio que /api/dashboard/operacional/filters.
    const clientOptionRows = await runQuery<{ v: string }>(
      `SELECT DISTINCT client_name AS v FROM ${TABLE} WHERE client_name IS NOT NULL AND client_name != '' ORDER BY v LIMIT 200`
    );

    return NextResponse.json({
      source: "local-duckdb",
      data: serializeRows(rows),
      meta: {
        total: Number(aggregateRows[0]?.total ?? 0),
        totalUsedParts: Number(aggregateRows[0]?.total_used_parts ?? 0),
        clientOptions: clientOptionRows.map(r => r.v),
        filters: { client, q, from, to }
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
