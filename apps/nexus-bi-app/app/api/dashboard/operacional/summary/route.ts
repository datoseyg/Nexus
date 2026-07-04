import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import {
  ESTADO_GENERAL_LABELS,
  ESTADO_GENERAL_ORDER,
  splitOriginLocations,
  TICKET_ESTADO_ORDER
} from "@/lib/dashboard-sql";
import {
  buildMartDateConditions,
  buildMartFilterSubquery,
  buildMartIdentityConditions,
  buildPeriodGroupExpr,
  buildUsedPartsFilterSubquery,
  buildZendeskConditions,
  createParamPusher,
  parseDashboardFilters,
  ticketEstadoCaseExpr
} from "@/lib/dashboard-filters";

const TOP_N_MAQUINAS = 10;
const TOP_N_CLIENTES_MAQUINAS = 8;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function whereFrom(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
}

// Alimenta, en el Tab "Dashboard Operacional":
// KPI row (kpis) · Distribución de Estados de TICKETS (estados) ·
// Evolución Operativa (evolucion) · Uso Bodegas / Clientes (bodegasClientes) ·
// Ranking Bodegas (rankingBodegas) · % Tickets por Cliente (ticketsCliente) ·
// Estado General (estadoGeneral) · Atenciones Máquinas x Clientes (maquinasClientes)
//
// Cada gráfico de identidad (cliente/bodega/estado/reportQuality) excluye
// su propio filtro al construirse ("self-exclusion") para no colapsar su
// propia distribución cuando el usuario ya hizo click sobre una de sus
// categorías - ver docs/DASHBOARD_VISUAL_STYLE.md § Cross-filter.
//
// Las tablas paginadas (Uso de Repuestos, Detalle Operativo) NO viven acá
// - ver /api/dashboard/operacional/parts y /detail.
export async function GET(request: NextRequest) {
  try {
    const filters = parseDashboardFilters(request.nextUrl.searchParams);

    // --- KPIs ---
    const kpiPusher = createParamPusher();
    const kpiConditions = [
      ...buildMartDateConditions(filters, "m", kpiPusher),
      ...buildMartIdentityConditions(filters, "m", kpiPusher)
    ];
    const kpiSubquery = buildUsedPartsFilterSubquery(filters, "m", kpiPusher);
    if (kpiSubquery) kpiConditions.push(kpiSubquery);

    const kpiRows = await runQuery<{
      total_registros: bigint;
      repuestos_usados: bigint;
      con_ticket_reportado: bigint;
      con_ticket_accesible: bigint;
    }>(
      `
        SELECT
          COUNT(*) AS total_registros,
          COALESCE(SUM(used_parts_count), 0) AS repuestos_usados,
          SUM(CASE WHEN zendesk_join_status != 'NO_TICKET_REPORTED' THEN 1 ELSE 0 END) AS con_ticket_reportado,
          SUM(CASE WHEN zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK' THEN 1 ELSE 0 END) AS con_ticket_accesible
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(kpiConditions)}
      `,
      kpiPusher.params
    );

    const ultimoClientePusher = createParamPusher();
    const ultimoClienteConditions = [
      ...buildMartDateConditions(filters, "m", ultimoClientePusher),
      ...buildMartIdentityConditions(filters, "m", ultimoClientePusher),
      `client_name != ''`
    ];
    const ultimoClienteSub = buildUsedPartsFilterSubquery(filters, "m", ultimoClientePusher);
    if (ultimoClienteSub) ultimoClienteConditions.push(ultimoClienteSub);

    const ultimoClienteRows = await runQuery<{ client_name: string }>(
      `
        SELECT client_name
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(ultimoClienteConditions)}
        ORDER BY fieldbeat_task_date DESC
        LIMIT 1
      `,
      ultimoClientePusher.params
    );

    // Total Tickets Zendesk: universo ticket-céntrico completo (628),
    // independiente del universo report-céntrico de arriba - ver
    // gold.operational_dashboard.total_zendesk_tickets.
    const totalTicketsPusher = createParamPusher();
    const totalTicketsConditions = buildZendeskConditions(filters, "z", totalTicketsPusher);
    const totalTicketsRows = await runQuery<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM processed.zendesk_tickets z ${whereFrom(totalTicketsConditions)}`,
      totalTicketsPusher.params
    );

    const totalRegistros = Number(kpiRows[0]?.total_registros ?? 0);
    const repuestosUsados = Number(kpiRows[0]?.repuestos_usados ?? 0);
    const conTicketReportado = Number(kpiRows[0]?.con_ticket_reportado ?? 0);
    const conTicketAccesible = Number(kpiRows[0]?.con_ticket_accesible ?? 0);

    const kpis = {
      totalRegistros,
      totalTickets: Number(totalTicketsRows[0]?.n ?? 0),
      repuestosUsados,
      pctConTicketReportado: totalRegistros > 0 ? (conTicketReportado / totalRegistros) * 100 : 0,
      pctConTicketAccesible: totalRegistros > 0 ? (conTicketAccesible / totalRegistros) * 100 : 0,
      ultimoCliente: ultimoClienteRows[0]?.client_name ?? null
    };

    // --- Distribución de Estados (TICKETS Zendesk, no task_state de
    // FieldBeat) - self-exclusion sobre "estadoTicket". ---
    const estadosPusher = createParamPusher();
    const estadosConditions = buildZendeskConditions(filters, "z", estadosPusher, ["estadoTicket"]);
    const estadosRaw = await runQuery<{ estado: string; cantidad: bigint }>(
      `
        SELECT ${ticketEstadoCaseExpr("z.status")} AS estado, COUNT(*) AS cantidad
        FROM processed.zendesk_tickets z
        ${whereFrom(estadosConditions)}
        GROUP BY 1
      `,
      estadosPusher.params
    );
    const estadosMap = new Map<string, number>(TICKET_ESTADO_ORDER.map(e => [e, 0]));
    for (const row of estadosRaw) estadosMap.set(row.estado, Number(row.cantidad));
    const estados = TICKET_ESTADO_ORDER.map(estado => ({ estado, cantidad: estadosMap.get(estado) ?? 0 }));

    // --- Evolución Operativa (solo serie "General" - ver nota), grain
    // configurable (day/week/month) ---
    const evolucionPusher = createParamPusher();
    const evolucionConditions = [
      ...buildMartDateConditions(filters, "m", evolucionPusher),
      ...buildMartIdentityConditions(filters, "m", evolucionPusher)
    ];
    const evolucionSub = buildUsedPartsFilterSubquery(filters, "m", evolucionPusher);
    if (evolucionSub) evolucionConditions.push(evolucionSub);

    const periodExpr = buildPeriodGroupExpr("fieldbeat_task_date", filters.grain);
    const evolucion = await runQuery(
      `
        SELECT ${periodExpr} AS periodo, COUNT(*) AS cantidad
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(evolucionConditions)}
        GROUP BY periodo
        ORDER BY periodo
      `,
      evolucionPusher.params
    );

    // --- Uso Bodegas (Dimensión Clientes) y Ranking Bodegas Utilizadas ---
    // Ambas parten de processed.fieldbeat_used_parts.origin_location (25.6%
    // de cobertura real). Cada una se calcula con su propia query para que
    // el self-exclusion sea preciso: "Uso Bodegas" excluye su propio filtro
    // "cliente" (pero SÍ respeta un filtro de "bodega" activo); "Ranking
    // Bodegas" excluye su propio filtro "bodega" (pero SÍ respeta "cliente").
    async function fetchBodegaRows(exclude: "cliente" | "bodega") {
      const pusher = createParamPusher();
      const conditions = [`up.origin_location IS NOT NULL`, `TRIM(up.origin_location) != ''`];
      if (filters.sku) {
        const placeholder = pusher.push(`%${filters.sku}%`);
        conditions.push(`(up.part_number ILIKE ${placeholder} OR up.dolibarr_ref ILIKE ${placeholder})`);
      }
      if (filters.bodega && exclude !== "bodega") conditions.push(`up.origin_location ILIKE ${pusher.push(`%${filters.bodega}%`)}`);
      const bridge = buildMartFilterSubquery(filters, "up", pusher, [exclude]);
      if (bridge) conditions.push(bridge);

      return runQuery<{ origin_location: string; client_name: string | null }>(
        `
          SELECT up.origin_location, m2.client_name
          FROM processed.fieldbeat_used_parts up
          LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view m2 ON up.fieldbeat_task_id = m2.fieldbeat_task_id
          ${whereFrom(conditions)}
        `,
        pusher.params
      );
    }

    const bodegaRowsForClientes = await fetchBodegaRows("cliente");
    const bodegaRowsForRanking = await fetchBodegaRows("bodega");

    const clienteCounts = new Map<string, number>();
    for (const row of bodegaRowsForClientes) {
      const locations = splitOriginLocations(row.origin_location);
      if (row.client_name) clienteCounts.set(row.client_name, (clienteCounts.get(row.client_name) ?? 0) + locations.length);
    }

    const bodegaCounts = new Map<string, number>();
    for (const row of bodegaRowsForRanking) {
      for (const location of splitOriginLocations(row.origin_location)) {
        bodegaCounts.set(location, (bodegaCounts.get(location) ?? 0) + 1);
      }
    }

    const bodegasClientesTotal = Array.from(clienteCounts.values()).reduce((a, b) => a + b, 0);
    const bodegasClientes = Array.from(clienteCounts.entries())
      .map(([cliente, cantidad]) => ({
        cliente,
        cantidad,
        pct: bodegasClientesTotal > 0 ? round1((cantidad / bodegasClientesTotal) * 100) : 0
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const rankingBodegasTotal = Array.from(bodegaCounts.values()).reduce((a, b) => a + b, 0);
    const rankingBodegas = Array.from(bodegaCounts.entries())
      .map(([bodega, cantidad]) => ({
        bodega,
        cantidad,
        pct: rankingBodegasTotal > 0 ? round1((cantidad / rankingBodegasTotal) * 100) : 0
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // --- % Tickets por Cliente (self-exclusion sobre "cliente") ---
    const ticketsClientePusher = createParamPusher();
    const ticketsClienteConditions = [
      ...buildMartDateConditions(filters, "m", ticketsClientePusher),
      ...buildMartIdentityConditions(filters, "m", ticketsClientePusher, ["cliente"]),
      `client_name != ''`
    ];
    const ticketsClienteSub = buildUsedPartsFilterSubquery(filters, "m", ticketsClientePusher);
    if (ticketsClienteSub) ticketsClienteConditions.push(ticketsClienteSub);

    const ticketsClienteRaw = await runQuery<{ client_name: string; total: bigint; reportado: bigint; accesibles: bigint }>(
      `
        SELECT
          client_name,
          COUNT(*) AS total,
          SUM(CASE WHEN zendesk_join_status != 'NO_TICKET_REPORTED' THEN 1 ELSE 0 END) AS reportado,
          SUM(CASE WHEN zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK' THEN 1 ELSE 0 END) AS accesibles
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(ticketsClienteConditions)}
        GROUP BY client_name
        ORDER BY total DESC
      `,
      ticketsClientePusher.params
    );

    const ticketsCliente = ticketsClienteRaw.map(row => ({
      cliente: row.client_name,
      total: Number(row.total),
      conTicketReportado: Number(row.reportado),
      accesibles: Number(row.accesibles),
      pct: Number(row.total) > 0 ? round1((Number(row.accesibles) / Number(row.total)) * 100) : 0
    }));

    // --- Estado General (report_quality_status remapeado), self-exclusion
    // sobre "reportQuality" ---
    const qualityPusher = createParamPusher();
    const qualityConditions = [
      ...buildMartDateConditions(filters, "m", qualityPusher),
      ...buildMartIdentityConditions(filters, "m", qualityPusher, ["reportQuality"])
    ];
    const qualitySub = buildUsedPartsFilterSubquery(filters, "m", qualityPusher);
    if (qualitySub) qualityConditions.push(qualitySub);

    const qualityRows = await runQuery<{ report_quality_status: string; cantidad: bigint }>(
      `
        SELECT report_quality_status, COUNT(*) AS cantidad
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(qualityConditions)}
        GROUP BY report_quality_status
      `,
      qualityPusher.params
    );

    const estadoGeneralMap = new Map<string, number>(ESTADO_GENERAL_ORDER.map(label => [label, 0]));
    for (const row of qualityRows) {
      const label = ESTADO_GENERAL_LABELS[row.report_quality_status] ?? "Error";
      estadoGeneralMap.set(label, (estadoGeneralMap.get(label) ?? 0) + Number(row.cantidad));
    }
    const estadoGeneral = ESTADO_GENERAL_ORDER.map(estado => ({ estado, cantidad: estadoGeneralMap.get(estado) ?? 0 }));

    // --- Atenciones Máquinas x Clientes (fan-out, top N), self-exclusion
    // sobre "cliente" y "maquina" (matriz con dos ejes clickeables) ---
    const maquinasPusher = createParamPusher();
    const maquinasConditions = [
      ...buildMartDateConditions(filters, "m", maquinasPusher),
      ...buildMartIdentityConditions(filters, "m", maquinasPusher, ["cliente", "maquina"]),
      `equipment_internal_ids != ''`,
      `client_name != ''`
    ];
    const maquinasSub = buildUsedPartsFilterSubquery(filters, "m", maquinasPusher);
    if (maquinasSub) maquinasConditions.push(maquinasSub);

    const maquinasClientesRaw = await runQuery<{ fieldbeat_task_id: bigint; client_name: string; equipment_internal_ids: string }>(
      `
        SELECT fieldbeat_task_id, client_name, equipment_internal_ids
        FROM marts.fieldbeat_report_dolibarr_operational_view m
        ${whereFrom(maquinasConditions)}
      `,
      maquinasPusher.params
    );

    const machineTotals = new Map<string, number>();
    const clientTotals = new Map<string, number>();
    const combo = new Map<string, number>();

    for (const row of maquinasClientesRaw) {
      for (const machine of row.equipment_internal_ids.split("|").map(s => s.trim()).filter(Boolean)) {
        machineTotals.set(machine, (machineTotals.get(machine) ?? 0) + 1);
        clientTotals.set(row.client_name, (clientTotals.get(row.client_name) ?? 0) + 1);
        const key = `${row.client_name}|||${machine}`;
        combo.set(key, (combo.get(key) ?? 0) + 1);
      }
    }

    const topMachines = Array.from(machineTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_N_MAQUINAS).map(([m]) => m);
    const topClients = Array.from(clientTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_N_CLIENTES_MAQUINAS).map(([c]) => c);

    const maquinasClientes = {
      clientes: topClients,
      maquinas: topMachines,
      series: topMachines.map(machine => ({
        maquina: machine,
        data: topClients.map(client => combo.get(`${client}|||${machine}`) ?? 0)
      }))
    };

    return NextResponse.json({
      filtersApplied: filters,
      kpis,
      estados: serializeRows(estados),
      evolucion: serializeRows(evolucion),
      bodegasClientes: { available: bodegasClientes.length > 0, values: bodegasClientes },
      rankingBodegas: { available: rankingBodegas.length > 0, values: rankingBodegas },
      ticketsCliente,
      estadoGeneral,
      maquinasClientes
    });
  } catch (error) {
    return handleApiError(error);
  }
}
