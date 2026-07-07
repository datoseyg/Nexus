import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { buildLifecycleAggregateConditions, createParamPusher, parseEquipmentLifecycleFilters } from "@/lib/equipment-lifecycle-filters";
import type { LifecycleAggregateRow } from "@/types/equipment-lifecycle";

// Catálogo global de repuestos rastreados por esta línea - lee
// gold.equipment_part_lifecycle_by_part (agregado global, todas las
// máquinas/clientes).
export async function GET(request: NextRequest) {
  try {
    const filters = parseEquipmentLifecycleFilters(request.nextUrl.searchParams);
    const pusher = createParamPusher();
    const conditions = buildLifecycleAggregateConditions(filters, "p", pusher, { hasEquipmentColumn: false, hasClientColumn: false });
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<LifecycleAggregateRow>(
      `
      SELECT p.*
      FROM gold.equipment_part_lifecycle_by_part p
      ${whereClause}
      ORDER BY p.observed_event_count DESC
      `,
      pusher.params
    );

    return NextResponse.json({ rows: serializeRows(rows as unknown as Record<string, unknown>[]) });
  } catch (error) {
    return handleApiError(error);
  }
}
