import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import {
  buildMartDateConditions,
  buildMartIdentityConditions,
  createParamPusher,
  JUNK_DOLIBARR_REFS,
  parseDashboardFilters
} from "@/lib/dashboard-filters";

// Alimenta: "Tabla Uso de Repuestos" del Tab "Dashboard Operacional".
// Fuente: marts.used_parts_dolibarr_match (solo match_status='MATCHED')
// unida a processed.fieldbeat_used_parts (cantidad, bodega) y a la mart
// report-céntrica (cliente, fecha, filtros). Responde "¿qué repuestos
// Dolibarr reales se usaron y cuánto?" — excluye explícitamente valores
// basura (N/A, S/N, NO HAY, etc.) y cualquier fila sin match real, ver
// docs/DASHBOARD_VISUAL_STYLE.md.
// "Pag. PDF" del dashboard de referencia no tiene equivalente -> se omite
// la columna en vez de mantenerla vacía sin aportar nada.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 10);
    const filters = parseDashboardFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = [
      `m.match_status = 'MATCHED'`,
      `m.dolibarr_ref IS NOT NULL`,
      `TRIM(m.dolibarr_ref) != ''`,
      `UPPER(TRIM(m.dolibarr_ref)) NOT IN (${JUNK_DOLIBARR_REFS.map(v => pusher.push(v)).join(", ")})`,
      ...buildMartDateConditions(filters, "r", pusher),
      ...buildMartIdentityConditions(filters, "r", pusher)
    ];

    if (filters.sku) {
      conditions.push(`m.dolibarr_ref ILIKE ${pusher.push(`%${filters.sku}%`)}`);
    }
    if (filters.bodega) {
      conditions.push(`p.origin_location ILIKE ${pusher.push(`%${filters.bodega}%`)}`);
    }

    const baseFrom = `
      FROM marts.used_parts_dolibarr_match m
      LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
      LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
      WHERE ${conditions.join(" AND ")}
    `;

    const countRows = await runQuery<{ n: bigint }>(
      `SELECT COUNT(DISTINCT m.dolibarr_ref) AS n ${baseFrom}`,
      pusher.params
    );
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `
        SELECT
          m.dolibarr_ref AS sku_dolibarr,
          COALESCE(MAX(m.dolibarr_label), MAX(m.part_name)) AS nombre_repuesto,
          SUM(COALESCE(p.quantity, 1)) AS cantidad_consumida,
          COUNT(DISTINCT m.fieldbeat_task_id) AS reportes_asociados,
          COUNT(DISTINCT r.client_name) AS clientes_asociados,
          STRING_AGG(DISTINCT m.match_method, ' | ') AS match_methods
        ${baseFrom}
        GROUP BY m.dolibarr_ref
        ORDER BY cantidad_consumida DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
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
