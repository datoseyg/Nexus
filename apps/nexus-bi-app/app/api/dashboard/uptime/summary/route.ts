import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { parseDashboardFilters } from "@/lib/dashboard-filters";

export const runtime = "nodejs";

// Alimenta: KPIs "Suma de horas que ha tomado cada Tipo de Tarea" +
// dropdowns de filtro del Tab "Integración Uptime / Downtime".
//
// IMPORTANTE (ver docs/DASHBOARD_VISUAL_STYLE.md): esto NO es downtime
// real. processed.fieldbeat_tasks.duration_minutes es la duración
// registrada del task en FieldBeat, no una medición de indisponibilidad
// de equipo con fórmula de negocio aprobada (horas base, feriados, etc.
// no existen en este warehouse). Se etiqueta "horas registradas" en toda
// la UI, nunca "downtime".
const TYPE_BUCKETS: Record<string, string[]> = {
  correctivasProgramadas: ["CORRECTIVA PROGRAMADA", "CORRECTIVA PROGRAMADA V2"],
  correctivasNoProgramadas: ["CORRECTIVA NO PROGRAMADA"],
  preventivasProgramadas: ["PREVENTIVA PROGRAMADA"],
  requerimientoCliente: ["REQUERIMIENTO DEL CLIENTE"],
  asistenciaRemota: ["ASISTENCIA REMOTA"],
  instalacionIntegracion: ["INSTALACION - INTEGRACION"]
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseDashboardFilters(searchParams);
    const cliente = searchParams.get("cliente");
    const tipo = searchParams.get("tipo");
    const maquina = searchParams.get("maquina");

    const conditions: string[] = [];
    const params: string[] = [];
    let paramIndex = 0;

    if (filters.from) { paramIndex += 1; conditions.push(`CAST(t.start_time AS DATE) >= $${paramIndex}::DATE`); params.push(filters.from); }
    if (filters.to) { paramIndex += 1; conditions.push(`CAST(t.start_time AS DATE) <= $${paramIndex}::DATE`); params.push(filters.to); }

    if (cliente || tipo || maquina) {
      const subConditions: string[] = [];
      if (cliente) { paramIndex += 1; subConditions.push(`client_name = $${paramIndex}`); params.push(cliente); }
      if (tipo) { paramIndex += 1; subConditions.push(`task_type = $${paramIndex}`); params.push(tipo); }
      if (maquina) { paramIndex += 1; subConditions.push(`equipment_internal_ids ILIKE $${paramIndex}`); params.push(`%${maquina}%`); }

      conditions.push(
        `t.fieldbeat_task_id IN (SELECT fieldbeat_task_id FROM marts.fieldbeat_report_dolibarr_operational_view WHERE ${subConditions.join(" AND ")})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<{ task_type: string | null; horas: number }>(
      `
        SELECT t.task_type, COALESCE(SUM(t.duration_minutes), 0) / 60.0 AS horas
        FROM processed.fieldbeat_tasks t
        ${whereClause}
        GROUP BY t.task_type
      `,
      params
    );

    const byType = new Map<string, number>();
    let totalHoras = 0;

    for (const row of rows) {
      const horas = Number(row.horas);
      totalHoras += horas;
      if (row.task_type) byType.set(row.task_type, (byType.get(row.task_type) ?? 0) + horas);
    }

    const kpis: Record<string, number> = { totalHorasRegistradas: totalHoras };
    for (const [bucket, types] of Object.entries(TYPE_BUCKETS)) {
      kpis[bucket] = types.reduce((sum, type) => sum + (byType.get(type) ?? 0), 0);
    }

    return NextResponse.json({ kpis, downtimeWarning: true });
  } catch (error) {
    return handleApiError(error);
  }
}
