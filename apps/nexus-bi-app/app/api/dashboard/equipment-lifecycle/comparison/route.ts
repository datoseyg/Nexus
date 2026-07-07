import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { createParamPusher } from "@/lib/equipment-lifecycle-filters";
import { buildSearchCondition } from "@/lib/filter-utils";
import type { LifecycleAggregateRow } from "@/types/equipment-lifecycle";

// Compara la vida útil estimada del mismo repuesto en: esta máquina, otras
// máquinas del mismo cliente, otros clientes, y el promedio global
// observado. Requiere equipment + dolibarrRef. Nunca afirma causalidad -
// solo expone los 4 niveles de agregación ya calculados en GOLD.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const equipment = searchParams.get("equipment");
    const dolibarrRef = searchParams.get("dolibarrRef");
    const q = searchParams.get("q")?.trim() || undefined;

    if (!equipment || !dolibarrRef) {
      return NextResponse.json({ error: "Se requieren los parámetros equipment y dolibarrRef", code: "MISSING_PARAMS" }, { status: 400 });
    }

    const machineRows = await runQuery<LifecycleAggregateRow>(
      `SELECT * FROM gold.equipment_part_lifecycle_by_machine WHERE equipment_internal_id = $1 AND dolibarr_ref = $2`,
      [equipment, dolibarrRef]
    );
    const machine = machineRows[0] ?? null;
    const clientName = machine?.client_name ?? null;

    // `q` es opcional acá (comparison siempre parte de un equipment+dolibarrRef
    // puntual) - solo afina las listas de "otras máquinas"/"otros clientes"
    // por nombre de cliente/repuesto.
    const siblingPusher = createParamPusher();
    const siblingConditions = [`dolibarr_ref = ${siblingPusher.push(dolibarrRef)}`, `equipment_internal_id != ${siblingPusher.push(equipment)}`];
    if (clientName) siblingConditions.push(`client_name = ${siblingPusher.push(clientName)}`);
    const siblingSearch = buildSearchCondition(q, ["client_name", "dolibarr_label"], siblingPusher);
    if (siblingSearch) siblingConditions.push(siblingSearch);

    const siblingMachines = await runQuery<LifecycleAggregateRow>(
      `SELECT * FROM gold.equipment_part_lifecycle_by_machine WHERE ${siblingConditions.join(" AND ")} ORDER BY observed_event_count DESC`,
      siblingPusher.params
    );

    const otherClientsPusher = createParamPusher();
    const otherClientsConditions = [`dolibarr_ref = ${otherClientsPusher.push(dolibarrRef)}`];
    if (clientName) otherClientsConditions.push(`client_name != ${otherClientsPusher.push(clientName)}`);
    const otherClientsSearch = buildSearchCondition(q, ["client_name", "dolibarr_label"], otherClientsPusher);
    if (otherClientsSearch) otherClientsConditions.push(otherClientsSearch);

    const otherClients = await runQuery<LifecycleAggregateRow>(
      `SELECT * FROM gold.equipment_part_lifecycle_by_client WHERE ${otherClientsConditions.join(" AND ")} ORDER BY observed_event_count DESC`,
      otherClientsPusher.params
    );

    const globalRows = await runQuery<LifecycleAggregateRow>(
      `SELECT * FROM gold.equipment_part_lifecycle_by_part WHERE dolibarr_ref = $1`,
      [dolibarrRef]
    );

    return NextResponse.json({
      machine: machine ? serializeRows([machine as unknown as Record<string, unknown>])[0] : null,
      siblingMachines: serializeRows(siblingMachines as unknown as Record<string, unknown>[]),
      otherClients: serializeRows(otherClients as unknown as Record<string, unknown>[]),
      global: globalRows[0] ? serializeRows([globalRows[0] as unknown as Record<string, unknown>])[0] : null
    });
  } catch (error) {
    return handleApiError(error);
  }
}
