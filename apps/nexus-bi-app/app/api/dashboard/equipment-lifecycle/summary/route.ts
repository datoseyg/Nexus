import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { createParamPusher } from "@/lib/equipment-lifecycle-filters";
import type { LifecycleSummary } from "@/types/equipment-lifecycle";

// KPIs globales de /dashboard/equipment-lifecycle. Lee el snapshot fijo
// gold.equipment_part_lifecycle_summary (1 fila) - el KPI en sí no se
// filtra (es un snapshot fijo, mismo criterio que
// /api/dashboard/after-hours/summary), pero `q` sí filtra las listas de
// filterOptions devueltas (para que la lupa también ayude a poblar los
// dropdowns de cliente/tipo de tarea).
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim();

    const summaryRows = await runQuery<{
      total_machine_part_combinations: bigint;
      total_machines_analyzed: bigint;
      total_parts_analyzed: bigint;
      total_clients_analyzed: bigint;
      estimate_status_breakdown: string;
      confidence_label_breakdown: string;
      total_insights_generated: bigint;
    }>(`SELECT * FROM gold.equipment_part_lifecycle_summary LIMIT 1`);

    const row = summaryRows[0];

    const clientePusher = createParamPusher();
    const clienteFilter = q ? ` AND client_name ILIKE ${clientePusher.push(`%${q}%`)}` : "";
    const tipoTareaPusher = createParamPusher();
    const tipoTareaFilter = q ? ` AND task_type ILIKE ${tipoTareaPusher.push(`%${q}%`)}` : "";

    const [clienteRows, tipoTareaRows] = await Promise.all([
      runQuery<{ v: string }>(
        `SELECT DISTINCT client_name AS v FROM marts.equipment_part_lifecycle_events WHERE client_name IS NOT NULL AND client_name != ''${clienteFilter} ORDER BY v`,
        clientePusher.params
      ),
      runQuery<{ v: string }>(
        `SELECT DISTINCT task_type AS v FROM marts.equipment_part_lifecycle_events WHERE task_type IS NOT NULL AND task_type != ''${tipoTareaFilter} ORDER BY v`,
        tipoTareaPusher.params
      )
    ]);

    const summary: LifecycleSummary = {
      total_machine_part_combinations: Number(row?.total_machine_part_combinations ?? 0),
      total_machines_analyzed: Number(row?.total_machines_analyzed ?? 0),
      total_parts_analyzed: Number(row?.total_parts_analyzed ?? 0),
      total_clients_analyzed: Number(row?.total_clients_analyzed ?? 0),
      estimate_status_breakdown: row?.estimate_status_breakdown ? JSON.parse(row.estimate_status_breakdown) : {},
      confidence_label_breakdown: row?.confidence_label_breakdown ? JSON.parse(row.confidence_label_breakdown) : {},
      total_insights_generated: Number(row?.total_insights_generated ?? 0),
      filterOptions: {
        clientes: clienteRows.map(r => r.v),
        tiposTarea: tipoTareaRows.map(r => r.v)
      }
    };

    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
