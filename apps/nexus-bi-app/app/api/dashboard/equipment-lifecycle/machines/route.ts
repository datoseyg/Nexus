import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { buildLifecycleAggregateConditions, createParamPusher, parseEquipmentLifecycleFilters } from "@/lib/equipment-lifecycle-filters";
import type { MachineListItem } from "@/types/equipment-lifecycle";

// Lista de máquinas para el selector de /dashboard/equipment-lifecycle -
// agregado desde gold.equipment_part_lifecycle_by_machine (snapshot fijo,
// igual criterio que /api/dashboard/uptime/table para listar equipos).
export async function GET(request: NextRequest) {
  try {
    const filters = parseEquipmentLifecycleFilters(request.nextUrl.searchParams);
    const pusher = createParamPusher();
    const conditions = buildLifecycleAggregateConditions(filters, "m", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<{
      equipment_internal_id: string;
      client_name: string | null;
      parts_tracked: bigint;
      reports_count: bigint | null;
      avg_confidence_score: number | null;
    }>(
      `
      SELECT
        m.equipment_internal_id,
        ANY_VALUE(m.client_name) AS client_name,
        COUNT(*) AS parts_tracked,
        SUM(m.observed_event_count) AS reports_count,
        AVG(m.lifecycle_confidence_score) AS avg_confidence_score
      FROM gold.equipment_part_lifecycle_by_machine m
      ${whereClause}
      GROUP BY m.equipment_internal_id
      ORDER BY m.equipment_internal_id
      `,
      pusher.params
    );

    const machines: MachineListItem[] = rows.map(row => ({
      equipment_internal_id: row.equipment_internal_id,
      client_name: row.client_name,
      parts_tracked: Number(row.parts_tracked),
      reports_count: Number(row.reports_count ?? 0),
      avg_confidence_score: row.avg_confidence_score !== null ? Math.round(row.avg_confidence_score * 10) / 10 : null
    }));

    return NextResponse.json({ rows: machines });
  } catch (error) {
    return handleApiError(error);
  }
}
