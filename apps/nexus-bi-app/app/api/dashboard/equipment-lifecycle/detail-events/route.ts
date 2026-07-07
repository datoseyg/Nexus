import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildLifecycleEventConditions, createParamPusher, parseEquipmentLifecycleFilters } from "@/lib/equipment-lifecycle-filters";
import type { EquipmentLifecycleEventRow } from "@/types/equipment-lifecycle";

// Tabla de eventos base (grano evento individual) - clon estructural de
// /api/dashboard/after-hours/detail. Fuente: marts.equipment_part_lifecycle_events,
// nunca las tablas GOLD. Muestra TODOS los eventos (incluyendo NO_MATCH/
// AMBIGUOUS/PLACEHOLDER) para trazabilidad completa - usar onlyReliable=true
// para ver solo los usados en el cálculo de vida útil.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseEquipmentLifecycleFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildLifecycleEventConditions(filters, "e", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const baseFrom = `FROM marts.equipment_part_lifecycle_events e ${whereClause}`;

    const countRows = await runQuery<{ n: bigint }>(`SELECT COUNT(*) AS n ${baseFrom}`, pusher.params);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery<EquipmentLifecycleEventRow>(
      `
      SELECT
        e.lifecycle_event_id, e.fieldbeat_task_id, e.event_date, e.client_name, e.equipment_internal_id,
        e.task_type, e.task_state, e.technician_names, e.used_part_id, e.part_name, e.quantity,
        e.dolibarr_ref, e.dolibarr_label, e.match_status, e.match_method, e.event_type_inferred,
        e.association_confidence_score, e.association_confidence_label, e.calculation_status, e.calculation_notes
      ${baseFrom}
      ORDER BY e.event_date DESC NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
      `,
      pusher.params
    );

    return NextResponse.json({ rows: serializeRows(rows as unknown as Record<string, unknown>[]), page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
