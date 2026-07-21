import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { createParamPusher } from "@/lib/dashboard-filters";
import { buildFieldbeatMartConditions, buildFieldbeatOrigenSubquery, parseFieldbeatFilters } from "@/lib/fieldbeat-filters";

export const runtime = "nodejs";

// ETAPA 6 - alimenta "Detalle de reportes" de /dashboard/fieldbeat, hasta
// ahora un placeholder "no disponible" (ver FieldbeatUnavailableDetailTable.tsx,
// ETAPA 5-V). Fuente: marts.fieldbeat_report_dolibarr_operational_view
// LEFT JOIN processed.fieldbeat_tasks (para created_in/duration_minutes,
// que la mart no expone - ver diagnóstico previo).
//
// "hora_termino_estimada" es SIEMPRE derivada (fieldbeat_task_date +
// duration_minutes), NUNCA un campo real - no existe una columna de hora
// de término en el origen (ver diagnóstico Fase 2). Se expone con ese
// nombre explícito, nunca como "hora_termino" a secas, para no aparentar
// un dato medido que en realidad es calculado.
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseFieldbeatFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildFieldbeatMartConditions(filters, "m", pusher);
    const origenSub = buildFieldbeatOrigenSubquery(filters, "m", pusher);
    if (origenSub) conditions.push(origenSub);

    const idTarea = searchParams.get("idTarea");
    if (idTarea) conditions.push(`CAST(m.fieldbeat_task_id AS VARCHAR) ILIKE ${pusher.push(`%${idTarea}%`)}`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);

    const countRows = await runQuery<{ n: string }>(
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
        m.fieldbeat_task_id,
        CAST(m.fieldbeat_task_date AS VARCHAR) AS fecha,
        t.created_in AS origen,
        m.technician_names AS tecnico,
        m.client_name AS cliente,
        m.equipment_internal_ids AS equipo,
        m.task_type AS tipo_tarea,
        m.linked_zendesk_ticket_id AS ticket,
        m.used_part_numbers AS sku,
        m.used_parts_count AS cantidad_repuestos,
        m.report_quality_status AS estado,
        t.duration_minutes,
        CASE WHEN t.duration_minutes IS NOT NULL
          THEN CAST(m.fieldbeat_task_date + (t.duration_minutes || ' minutes')::interval AS VARCHAR)
          ELSE NULL END AS hora_termino_estimada
      FROM marts.fieldbeat_report_dolibarr_operational_view m
      LEFT JOIN processed.fieldbeat_tasks t ON t.fieldbeat_task_id = m.fieldbeat_task_id
      ${whereClause}
      ORDER BY m.fieldbeat_task_date DESC NULLS LAST
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
