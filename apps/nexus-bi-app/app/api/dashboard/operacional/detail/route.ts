import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import {
  buildMartDateConditions,
  buildMartIdentityConditions,
  buildUsedPartsFilterSubquery,
  createParamPusher,
  parseDashboardFilters
} from "@/lib/dashboard-filters";

// Alimenta: "Detalle Operativo" del Tab "Dashboard Operacional".
// Fuente: marts.fieldbeat_report_dolibarr_operational_view.
// "Origen" (General/Apoteca) usa la misma heurística documentada del
// filtro origenRegistro (equipment_internal_ids contiene "APOTECA") - ver
// docs/DASHBOARD_VISUAL_STYLE.md. No es un campo real del pipeline, se
// deriva y se etiqueta como tal.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseDashboardFilters(searchParams);
    const idTarea = searchParams.get("idTarea");
    const idTicket = searchParams.get("idTicket");

    const pusher = createParamPusher();
    const conditions = [
      ...buildMartDateConditions(filters, "m", pusher),
      ...buildMartIdentityConditions(filters, "m", pusher)
    ];
    const usedPartsSub = buildUsedPartsFilterSubquery(filters, "m", pusher);
    if (usedPartsSub) conditions.push(usedPartsSub);

    if (idTarea) conditions.push(`CAST(m.fieldbeat_task_id AS VARCHAR) ILIKE ${pusher.push(`%${idTarea}%`)}`);
    if (idTicket) conditions.push(`m.linked_zendesk_ticket_id ILIKE ${pusher.push(`%${idTicket}%`)}`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);

    const countRows = await runQuery<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view m ${whereClause}`,
      pusher.params
    );
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `
        SELECT
          m.fieldbeat_task_date,
          m.fieldbeat_task_id,
          m.client_name,
          m.linked_zendesk_ticket_id,
          m.equipment_internal_ids,
          m.used_part_numbers,
          m.task_type,
          m.used_parts_count,
          CASE WHEN UPPER(COALESCE(m.equipment_internal_ids, '')) LIKE '%APOTECA%' THEN 'Apoteca' ELSE 'General' END AS origen
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereClause}
        ORDER BY m.fieldbeat_task_date DESC
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
