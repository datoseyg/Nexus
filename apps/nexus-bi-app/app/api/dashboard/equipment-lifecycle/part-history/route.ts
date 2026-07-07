import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { buildLifecycleEventConditions, createParamPusher, parseEquipmentLifecycleFilters } from "@/lib/equipment-lifecycle-filters";
import type { EquipmentLifecycleEventRow } from "@/types/equipment-lifecycle";

// Timeline de eventos de un repuesto en una máquina - para
// PartHistoryTimeline.tsx. Requiere equipment + dolibarrRef (si no vienen,
// devuelve vacío en vez de listar todo el universo de eventos).
export async function GET(request: NextRequest) {
  try {
    const filters = parseEquipmentLifecycleFilters(request.nextUrl.searchParams);

    if (!filters.equipment || !filters.dolibarrRef) {
      return NextResponse.json({ rows: [] });
    }

    const pusher = createParamPusher();
    const conditions = buildLifecycleEventConditions(filters, "e", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<EquipmentLifecycleEventRow>(
      `
      SELECT
        e.lifecycle_event_id, e.fieldbeat_task_id, e.event_date, e.client_name, e.equipment_internal_id,
        e.task_type, e.task_state, e.technician_names, e.used_part_id, e.part_name, e.quantity,
        e.dolibarr_ref, e.dolibarr_label, e.match_status, e.match_method, e.event_type_inferred,
        e.association_confidence_score, e.association_confidence_label, e.calculation_status, e.calculation_notes
      FROM marts.equipment_part_lifecycle_events e
      ${whereClause}
      ORDER BY e.event_date ASC NULLS LAST
      `,
      pusher.params
    );

    return NextResponse.json({ rows: serializeRows(rows as unknown as Record<string, unknown>[]) });
  } catch (error) {
    return handleApiError(error);
  }
}
