import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { createParamPusher, type ParamPusher } from "@/lib/dashboard-filters";
import {
  buildFieldbeatMartConditions,
  buildFieldbeatOrigenSubquery,
  buildPeriodGroupExpr,
  parseFieldbeatFilters,
  type FieldbeatFilterKey,
  type FieldbeatFilters
} from "@/lib/fieldbeat-filters";

export const runtime = "nodejs";

const TOP_N = 10;
const TOP_N_CROSS_CLIENTS = 8;

function whereFrom(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
}

function buildConditions(filters: FieldbeatFilters, pusher: ParamPusher, exclude: FieldbeatFilterKey[] = []): string[] {
  const conditions = buildFieldbeatMartConditions(filters, "m", pusher, exclude);
  const origenSub = buildFieldbeatOrigenSubquery(filters, "m", pusher, exclude);
  if (origenSub) conditions.push(origenSub);
  return conditions;
}

function splitEquipment(value: string): string[] {
  return value.split("|").map(s => s.trim()).filter(Boolean);
}

// ETAPA 6 - alimenta las secciones que ETAPA 5-V dejó como "no disponible"
// en /dashboard/fieldbeat (evolución, tipo de tarea, cruce cliente×equipo,
// cruce cliente×tipo de tarea, actividad más reciente, clientes con
// actividad, equipos atendidos). Fuente:
// marts.fieldbeat_report_dolibarr_operational_view (mismo mart que
// /api/dashboard/operacional/summary, ver diagnóstico previo campo por
// campo) - NUNCA los 5 agregados GOLD fijos de /api/dashboard/fieldbeat
// (esos representan todo el historial por diseño y no son filtrables, ver
// comentario en ese route.ts - no se tocan acá).
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const filters = parseFieldbeatFilters(request.nextUrl.searchParams);

    // --- Evolución (grain configurable, mismo criterio que Operacional) ---
    const evolPusher = createParamPusher();
    const evolConditions = buildConditions(filters, evolPusher);
    const periodExpr = buildPeriodGroupExpr("fieldbeat_task_date", filters.grain);
    const evolutionRows = await runQuery<{ periodo: string; cantidad: string }>(
      `
        SELECT ${periodExpr} AS periodo, COUNT(*) AS cantidad
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(evolConditions)}
        GROUP BY periodo
        ORDER BY periodo
      `,
      evolPusher.params
    );

    // --- Distribución por tipo de tarea (self-exclusion: tipoTarea) ---
    const taskTypePusher = createParamPusher();
    const taskTypeConditions = buildConditions(filters, taskTypePusher, ["tipoTarea"]);
    const taskTypeRows = await runQuery<{ task_type: string; cantidad: string }>(
      `
        SELECT COALESCE(NULLIF(task_type, ''), 'Sin tipo registrado') AS task_type, COUNT(*) AS cantidad
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(taskTypeConditions)}
        GROUP BY 1
        ORDER BY 2 DESC
      `,
      taskTypePusher.params
    );

    // --- Actividad más reciente ---
    const recentPusher = createParamPusher();
    const recentConditions = buildConditions(filters, recentPusher);
    const recentRows = await runQuery<{ fecha: string | null; client_name: string | null; task_type: string | null }>(
      `
        SELECT CAST(fieldbeat_task_date AS VARCHAR) AS fecha, client_name, task_type
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(recentConditions)}
        ORDER BY fieldbeat_task_date DESC NULLS LAST
        LIMIT 1
      `,
      recentPusher.params
    );

    // --- Clientes con actividad (ranking, self-exclusion: cliente) ---
    const clientPusher = createParamPusher();
    const clientConditions = [...buildConditions(filters, clientPusher, ["cliente"]), `client_name != ''`];
    const clientActivityRows = await runQuery<{ client_name: string; cantidad: string }>(
      `
        SELECT client_name, COUNT(*) AS cantidad
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(clientConditions)}
        GROUP BY client_name
        ORDER BY cantidad DESC
        LIMIT ${TOP_N}
      `,
      clientPusher.params
    );

    // --- Equipos atendidos (fan-out sobre equipment_internal_ids, self-exclusion: equipo) ---
    const equipPusher = createParamPusher();
    const equipConditions = [...buildConditions(filters, equipPusher, ["equipo"]), `equipment_internal_ids != ''`];
    const equipRows = await runQuery<{ equipment_internal_ids: string }>(
      `
        SELECT equipment_internal_ids
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(equipConditions)}
      `,
      equipPusher.params
    );
    const equipCounts = new Map<string, number>();
    for (const row of equipRows) {
      for (const eq of splitEquipment(row.equipment_internal_ids)) {
        equipCounts.set(eq, (equipCounts.get(eq) ?? 0) + 1);
      }
    }
    const equipmentActivity = Array.from(equipCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([equipment_internal_id, cantidad]) => ({ equipment_internal_id, cantidad }));

    // --- Cruce cliente x equipo (fan-out, top N equipos x top N clientes) ---
    const crossEqPusher = createParamPusher();
    const crossEqConditions = [...buildConditions(filters, crossEqPusher), `equipment_internal_ids != ''`, `client_name != ''`];
    const crossEqRows = await runQuery<{ client_name: string; equipment_internal_ids: string }>(
      `
        SELECT client_name, equipment_internal_ids
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(crossEqConditions)}
      `,
      crossEqPusher.params
    );
    const machineTotals = new Map<string, number>();
    const clientTotalsEq = new Map<string, number>();
    const comboEq = new Map<string, number>();
    for (const row of crossEqRows) {
      for (const eq of splitEquipment(row.equipment_internal_ids)) {
        machineTotals.set(eq, (machineTotals.get(eq) ?? 0) + 1);
        clientTotalsEq.set(row.client_name, (clientTotalsEq.get(row.client_name) ?? 0) + 1);
        const key = `${row.client_name}|||${eq}`;
        comboEq.set(key, (comboEq.get(key) ?? 0) + 1);
      }
    }
    const topMachines = Array.from(machineTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([m]) => m);
    const topClientsEq = Array.from(clientTotalsEq.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_N_CROSS_CLIENTS).map(([c]) => c);
    const clientEquipmentCross = {
      clientes: topClientsEq,
      equipos: topMachines,
      series: topMachines.map(equipo => ({
        equipo,
        data: topClientsEq.map(cliente => comboEq.get(`${cliente}|||${equipo}`) ?? 0)
      }))
    };

    // --- Cruce cliente x tipo de tarea ---
    const crossTtPusher = createParamPusher();
    const crossTtConditions = [...buildConditions(filters, crossTtPusher), `client_name != ''`, `task_type IS NOT NULL`, `task_type != ''`];
    const crossTtRows = await runQuery<{ client_name: string; task_type: string; cantidad: string }>(
      `
        SELECT client_name, task_type, COUNT(*) AS cantidad
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(crossTtConditions)}
        GROUP BY client_name, task_type
      `,
      crossTtPusher.params
    );
    const clientTotalsTt = new Map<string, number>();
    for (const row of crossTtRows) clientTotalsTt.set(row.client_name, (clientTotalsTt.get(row.client_name) ?? 0) + Number(row.cantidad));
    const topClientsTt = Array.from(clientTotalsTt.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_N_CROSS_CLIENTS).map(([c]) => c);
    const taskTypeTotalsForCross = new Map<string, number>();
    for (const row of crossTtRows) taskTypeTotalsForCross.set(row.task_type, (taskTypeTotalsForCross.get(row.task_type) ?? 0) + Number(row.cantidad));
    const topTaskTypesForCross = Array.from(taskTypeTotalsForCross.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([t]) => t);
    const comboTt = new Map<string, number>();
    for (const row of crossTtRows) comboTt.set(`${row.client_name}|||${row.task_type}`, Number(row.cantidad));
    const clientTaskTypeCross = {
      clientes: topClientsTt,
      tiposTarea: topTaskTypesForCross,
      series: topTaskTypesForCross.map(tipoTarea => ({
        tipoTarea,
        data: topClientsTt.map(cliente => comboTt.get(`${cliente}|||${tipoTarea}`) ?? 0)
      }))
    };

    const totalPusher = createParamPusher();
    const totalConditions = buildConditions(filters, totalPusher);
    const totalRows = await runQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view m ${whereFrom(totalConditions)}`,
      totalPusher.params
    );

    return NextResponse.json({
      filtersApplied: filters,
      totalFiltered: Number(totalRows[0]?.n ?? 0),
      evolution: serializeRows(evolutionRows).map(r => ({ periodo: r.periodo, cantidad: Number(r.cantidad) })),
      taskTypeDistribution: serializeRows(taskTypeRows).map(r => ({ task_type: r.task_type, cantidad: Number(r.cantidad) })),
      mostRecentActivity: recentRows[0]?.fecha
        ? { fecha: recentRows[0].fecha, cliente: recentRows[0].client_name, tipoTarea: recentRows[0].task_type }
        : null,
      clientActivity: serializeRows(clientActivityRows).map(r => ({ cliente: r.client_name, cantidad: Number(r.cantidad) })),
      equipmentActivity,
      clientEquipmentCross,
      clientTaskTypeCross
    });
  } catch (error) {
    return handleApiError(error);
  }
}
