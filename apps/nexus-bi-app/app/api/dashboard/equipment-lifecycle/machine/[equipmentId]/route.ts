import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { buildLifecycleAggregateConditions, createParamPusher, parseEquipmentLifecycleFilters } from "@/lib/equipment-lifecycle-filters";
import type { LifecycleAggregateRow, MachineProfile } from "@/types/equipment-lifecycle";

interface RouteParams {
  params: Promise<{ equipmentId: string }>;
}

// Sentinel de ruta para "Todas las máquinas" (ver EquipmentSelector.tsx /
// SelectWithAll) - no es un equipment_internal_id real, así que se
// distingue explícitamente antes de armar cualquier condición SQL.
const ALL_MACHINES_SENTINEL = "ALL";

// Ficha de máquina: repuestos observados (gold.equipment_part_lifecycle_by_machine)
// + perfil agregado (marts.equipment_part_lifecycle_events en vivo, para que
// horas de operación/reportes reflejen todos los eventos, no solo los usados
// en el cálculo de vida útil). Si equipmentId="ALL", devuelve los repuestos
// de TODAS las máquinas (respetando el resto de los filtros) y profile=null
// (no existe una "ficha" única cuando no hay una máquina puntual elegida).
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { equipmentId } = await params;
    const isAllMachines = equipmentId === ALL_MACHINES_SENTINEL;
    const filters = parseEquipmentLifecycleFilters(request.nextUrl.searchParams);

    // hasClientColumn solo se desactiva cuando hay una máquina puntual
    // (ya viene fija por el path param, filtrar por cliente ahí sería
    // redundante) - en modo "Todas" el filtro de cliente sí debe aplicarse.
    const partsPusher = createParamPusher();
    const extraConditions = buildLifecycleAggregateConditions(filters, "m", partsPusher, { hasEquipmentColumn: false, hasClientColumn: isAllMachines });
    const conditions = isAllMachines ? extraConditions : [`m.equipment_internal_id = ${partsPusher.push(equipmentId)}`, ...extraConditions];
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const parts = await runQuery<LifecycleAggregateRow>(
      `
      SELECT m.*
      FROM gold.equipment_part_lifecycle_by_machine m
      ${whereClause}
      ORDER BY m.observed_event_count DESC
      `,
      partsPusher.params
    );

    let profile: MachineProfile | null = null;

    if (!isAllMachines) {
      const profileRows = await runQuery<{
        equipment_internal_id: string;
        client_name: string | null;
        reports_count: bigint;
        parts_observed: bigint;
        first_event_date: string | null;
        last_event_date: string | null;
        business_minutes_total: number | null;
        after_hours_minutes_total: number | null;
      }>(
        `
        SELECT
          e.equipment_internal_id,
          ANY_VALUE(e.client_name) AS client_name,
          COUNT(DISTINCT e.fieldbeat_task_id) AS reports_count,
          COUNT(DISTINCT e.dolibarr_ref) FILTER (WHERE e.match_status = 'MATCHED') AS parts_observed,
          MIN(e.event_date) AS first_event_date,
          MAX(e.event_date) AS last_event_date,
          SUM(TRY_CAST(e.business_minutes AS DOUBLE)) AS business_minutes_total,
          SUM(TRY_CAST(e.after_hours_minutes AS DOUBLE)) AS after_hours_minutes_total
        FROM marts.equipment_part_lifecycle_events e
        WHERE e.equipment_internal_id = $1
        GROUP BY e.equipment_internal_id
        `,
        [equipmentId]
      );

      const profileRow = profileRows[0];
      profile = profileRow
        ? {
            equipment_internal_id: profileRow.equipment_internal_id,
            client_name: profileRow.client_name,
            reports_count: Number(profileRow.reports_count),
            parts_observed: Number(profileRow.parts_observed),
            first_event_date: profileRow.first_event_date,
            last_event_date: profileRow.last_event_date,
            business_minutes_total: profileRow.business_minutes_total,
            after_hours_minutes_total: profileRow.after_hours_minutes_total
          }
        : null;
    }

    const serializedProfile = profile ? serializeRows([profile as unknown as Record<string, unknown>])[0] : null;

    return NextResponse.json({ profile: serializedProfile, parts: serializeRows(parts as unknown as Record<string, unknown>[]) });
  } catch (error) {
    return handleApiError(error);
  }
}
