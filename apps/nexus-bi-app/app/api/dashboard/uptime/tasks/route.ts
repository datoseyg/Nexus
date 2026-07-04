import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { parseDashboardFilters } from "@/lib/dashboard-filters";

// Alimenta: "Tabla de tareas" del Tab "Integración Uptime / Downtime".
// Fuente: processed.fieldbeat_tasks, join a la vista report-céntrica
// solo para traer client_name (fieldbeat_tasks no tiene el nombre de
// cliente resuelto directo, solo client_key).
//
// "Hora de término" usa last_transition_at (100% de cobertura) en vez de
// finished_data_synced_at (solo 8% de cobertura) - es una aproximación
// documentada, no la hora de término real garantizada.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseDashboardFilters(searchParams);
    const taskId = searchParams.get("taskId");
    const cliente = searchParams.get("cliente");
    const tipo = searchParams.get("tipo");

    const conditions: string[] = [];
    const params: string[] = [];
    let paramIndex = 0;

    if (filters.from) { paramIndex += 1; conditions.push(`CAST(t.start_time AS DATE) >= $${paramIndex}::DATE`); params.push(filters.from); }
    if (filters.to) { paramIndex += 1; conditions.push(`CAST(t.start_time AS DATE) <= $${paramIndex}::DATE`); params.push(filters.to); }

    if (taskId) {
      paramIndex += 1;
      conditions.push(`CAST(t.fieldbeat_task_id AS VARCHAR) ILIKE $${paramIndex}`);
      params.push(`%${taskId}%`);
    }
    if (cliente) {
      paramIndex += 1;
      conditions.push(`m.client_name = $${paramIndex}`);
      params.push(cliente);
    }
    if (tipo) {
      paramIndex += 1;
      conditions.push(`t.task_type = $${paramIndex}`);
      params.push(tipo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);

    const baseFrom = `
      FROM processed.fieldbeat_tasks t
      LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view m ON t.fieldbeat_task_id = m.fieldbeat_task_id
      ${whereClause}
    `;

    const countRows = await runQuery<{ n: bigint }>(`SELECT COUNT(*) AS n ${baseFrom}`, params);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `
        SELECT
          t.fieldbeat_task_id,
          m.client_name,
          t.task_type,
          t.start_time,
          t.last_transition_at,
          t.duration_minutes
        ${baseFrom}
        ORDER BY t.start_time DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      params
    );

    return NextResponse.json({
      rows: serializeRows(rows),
      page: safePage,
      pageSize,
      totalRows,
      totalPages
    });
  } catch (error) {
    return handleApiError(error);
  }
}
