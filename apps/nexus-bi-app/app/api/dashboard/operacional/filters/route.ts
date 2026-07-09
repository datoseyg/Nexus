import { NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { splitOriginLocations, TICKET_ESTADO_ORDER } from "@/lib/dashboard-sql";

export const runtime = "nodejs";

// Alimenta: FilterBar (dropdowns de cliente, tipo de tarea, máquina,
// estado de ticket, origen de registro) + límites del calendario del Tab
// "Dashboard Operacional". "bodega" devuelve { available, values, note }
// con la cobertura real; "origenRegistro" es una heurística documentada
// (ver docs/DASHBOARD_VISUAL_STYLE.md) - no un campo directo del pipeline.
export async function GET() {
  try {
    const clientesRows = await runQuery<{ client_name: string }>(`
      SELECT DISTINCT client_name
      FROM marts.fieldbeat_report_dolibarr_operational_view
      WHERE client_name IS NOT NULL AND client_name != ''
      ORDER BY client_name
    `);

    const tiposTareaRows = await runQuery<{ task_type: string }>(`
      SELECT DISTINCT task_type
      FROM marts.fieldbeat_report_dolibarr_operational_view
      WHERE task_type IS NOT NULL AND task_type != ''
      ORDER BY task_type
    `);

    const maquinasRows = await runQuery<{ equipo: string }>(`
      SELECT DISTINCT UNNEST(STRING_SPLIT(equipment_internal_ids, '|')) AS equipo
      FROM marts.fieldbeat_report_dolibarr_operational_view
      WHERE equipment_internal_ids IS NOT NULL AND equipment_internal_ids != ''
      ORDER BY equipo
    `);

    // Límites reales de fecha para el calendario/rango - un extremo por
    // universo (report-céntrico usa fieldbeat_task_date, ticket-céntrico
    // usa created_at); el picker usa la unión de ambos.
    const martDateRangeRows = await runQuery<{ mn: string; mx: string }>(`
      SELECT CAST(MIN(fieldbeat_task_date) AS VARCHAR) AS mn, CAST(MAX(fieldbeat_task_date) AS VARCHAR) AS mx
      FROM marts.fieldbeat_report_dolibarr_operational_view
      WHERE fieldbeat_task_date IS NOT NULL
    `);
    const zendeskDateRangeRows = await runQuery<{ mn: string; mx: string }>(`
      SELECT CAST(MIN(created_at) AS VARCHAR) AS mn, CAST(MAX(created_at) AS VARCHAR) AS mx
      FROM processed.zendesk_tickets
      WHERE created_at IS NOT NULL
    `);

    // origin_location existe y tiene datos reales (561 de 2193 repuestos,
    // ~25.6%) - se expone como filtro de "Bodega", con la cobertura real
    // informada, no oculto ni inventado.
    const bodegaRows = await runQuery<{ origin_location: string }>(`
      SELECT origin_location
      FROM processed.fieldbeat_used_parts
      WHERE origin_location IS NOT NULL AND TRIM(origin_location) != ''
    `);
    const bodegaCoverage = await runQuery<{ total: number; con_valor: number }>(`
      SELECT COUNT(*) AS total, COUNT(NULLIF(TRIM(origin_location), '')) AS con_valor
      FROM processed.fieldbeat_used_parts
    `);

    const bodegaSet = new Set<string>();
    for (const row of bodegaRows) {
      for (const value of splitOriginLocations(row.origin_location)) bodegaSet.add(value);
    }

    // "Origen Registro" (General/Apoteca): no existe un campo explícito en
    // este warehouse. Se probó la heurística contra client_name,
    // origin_location y equipment_internal_ids - solo equipment_internal_ids
    // tiene coincidencias reales de "APOTECA" (269 de 3747 reportes,
    // ~7.18%). El filtro se expone con esa base real y su cobertura
    // documentada, nunca oculto ni inventado.
    const apotecaCountRows = await runQuery<{ n: bigint }>(`
      SELECT COUNT(*) AS n
      FROM marts.fieldbeat_report_dolibarr_operational_view
      WHERE UPPER(COALESCE(equipment_internal_ids, '')) LIKE '%APOTECA%'
    `);
    const totalReportsRows = await runQuery<{ n: bigint }>(`
      SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view
    `);

    return NextResponse.json({
      clientes: clientesRows.map(r => r.client_name),
      tiposTarea: tiposTareaRows.map(r => r.task_type),
      maquinas: maquinasRows.map(r => r.equipo),
      estadosTicket: TICKET_ESTADO_ORDER,
      dateRange: {
        reportCentric: { min: martDateRangeRows[0]?.mn?.slice(0, 10) ?? null, max: martDateRangeRows[0]?.mx?.slice(0, 10) ?? null },
        ticketCentric: { min: zendeskDateRangeRows[0]?.mn?.slice(0, 10) ?? null, max: zendeskDateRangeRows[0]?.mx?.slice(0, 10) ?? null }
      },
      bodegas: {
        available: bodegaSet.size > 0,
        values: Array.from(bodegaSet).sort(),
        note: `Disponible solo para ${bodegaCoverage[0]?.con_valor ?? 0} de ${bodegaCoverage[0]?.total ?? 0} repuestos registrados - el resto no tiene bodega de origen documentada en FieldBeat.`
      },
      origenRegistro: {
        available: true,
        values: ["General", "Apoteca"],
        note: `Clasificación estimada: "Apoteca" = equipment_internal_ids contiene "APOTECA" (${Number(apotecaCountRows[0]?.n ?? 0)} de ${Number(totalReportsRows[0]?.n ?? 0)} reportes, ~${totalReportsRows[0]?.n ? round1((Number(apotecaCountRows[0]?.n ?? 0) / Number(totalReportsRows[0].n)) * 100) : 0}%); no existe un campo explícito equivalente en este warehouse.`
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
