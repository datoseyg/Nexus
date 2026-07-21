import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { parseDashboardFilters } from "@/lib/dashboard-filters";

export const runtime = "nodejs";

// Alimenta: "Tabla Uptime/Downtime por cliente-máquina" (parcial, ver
// nota) + "Duración registrada por Año-Mes" del Tab "Integración
// Uptime / Downtime".
//
// Las columnas HC_calc / %Uptime / THA / HC teórica del dashboard de
// referencia NO se calculan acá - no existe en este warehouse una
// fórmula de uptime aprobada por negocio (horas base por día/semana,
// feriados, etc.). Se devuelven como `null` y la UI las muestra como
// "Pendiente de parametrización".
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 10);
    const filters = parseDashboardFilters(searchParams);

    const dateParams: string[] = [];
    const dateConditions: string[] = [];
    if (filters.from) { dateConditions.push(`CAST(t.start_time AS DATE) >= $${dateParams.length + 1}::DATE`); dateParams.push(filters.from); }
    if (filters.to) { dateConditions.push(`CAST(t.start_time AS DATE) <= $${dateParams.length + 1}::DATE`); dateParams.push(filters.to); }

    const rawRows = await runQuery<{
      client_name: string;
      equipment_internal_ids: string;
      task_type: string | null;
      duration_minutes: number | null;
    }>(
      `
        SELECT m.client_name, m.equipment_internal_ids, t.task_type, t.duration_minutes
        FROM processed.fieldbeat_tasks t
        JOIN marts.fieldbeat_report_dolibarr_operational_view m ON t.fieldbeat_task_id = m.fieldbeat_task_id
        WHERE m.client_name != '' AND m.equipment_internal_ids != '' ${dateConditions.map(c => `AND ${c}`).join(" ")}
      `,
      dateParams
    );

    interface Bucket {
      cliente: string;
      maquina: string;
      hrsPreventiva: number;
      hrsCorrectivaProgramada: number;
      hrsTotalRegistradas: number;
    }

    const buckets = new Map<string, Bucket>();

    for (const row of rawRows) {
      const horas = Number(row.duration_minutes ?? 0) / 60;
      const machines = row.equipment_internal_ids.split("|").map(s => s.trim()).filter(Boolean);

      for (const machine of machines) {
        const key = `${row.client_name}|||${machine}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            cliente: row.client_name,
            maquina: machine,
            hrsPreventiva: 0,
            hrsCorrectivaProgramada: 0,
            hrsTotalRegistradas: 0
          });
        }

        const bucket = buckets.get(key)!;
        bucket.hrsTotalRegistradas += horas;
        if (row.task_type === "PREVENTIVA PROGRAMADA") bucket.hrsPreventiva += horas;
        if (row.task_type === "CORRECTIVA PROGRAMADA" || row.task_type === "CORRECTIVA PROGRAMADA V2") {
          bucket.hrsCorrectivaProgramada += horas;
        }
      }
    }

    const allRows = Array.from(buckets.values())
      .sort((a, b) => b.hrsTotalRegistradas - a.hrsTotalRegistradas)
      .map(row => ({
        ...row,
        hcCalc: null,
        uptimePct: null,
        tha: null,
        hcTeorica: null
      }));

    const totalRows = allRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const pageRows = allRows.slice(offset, offset + pageSize);

    // Duración registrada por Año-Mes (reemplaza "Downtime por Año-Mes"
    // del dashboard de referencia - ver advertencia arriba).
    const periodRows = await runQuery<{ anio: number; mes: number; horas: number }>(`
      SELECT
        CAST(TO_CHAR(start_time, 'YYYY') AS INTEGER) AS anio,
        CAST(TO_CHAR(start_time, 'MM') AS INTEGER) AS mes,
        COALESCE(SUM(duration_minutes), 0) / 60.0 AS horas
      FROM processed.fieldbeat_tasks
      WHERE start_time IS NOT NULL
      GROUP BY anio, mes
      ORDER BY anio, mes
    `);

    return NextResponse.json({
      table: {
        rows: pageRows,
        page: safePage,
        pageSize,
        totalRows,
        totalPages,
        pendingNote: "El cálculo de uptime final requiere parametrización de horas base, feriados y fórmula aprobada por negocio."
      },
      periodChart: periodRows.map(row => ({ anio: Number(row.anio), mes: Number(row.mes), horas: Number(row.horas) }))
    });
  } catch (error) {
    return handleApiError(error);
  }
}
