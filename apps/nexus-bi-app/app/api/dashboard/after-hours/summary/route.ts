import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { getAfterHoursConfigStatus } from "@/lib/after-hours-config";
import { getConfidenceLabel } from "@/lib/confidence";
import type { AfterHoursSummary, MetricWithConfidence } from "@/types/after-hours";

export const runtime = "nodejs";

// Alimenta los 6 KPIs de /dashboard/after-hours. Consulta
// marts.fieldbeat_working_hours_analysis EN VIVO (no las tablas GOLD - acá
// GOLD es el snapshot fijo tipo cookbook SQL, los endpoints filtrables
// siempre pegan contra el mart, mismo patrón que /api/dashboard/uptime/*).
//
// Las fórmulas de confianza (KPI 1-4 ponderado por duration_minutes, KPI 5
// promedio simple, KPI 6 fijo con penalización) son la re-expresión SQL
// exacta de aggregateMetricConfidence() en src/lib/calculation-confidence.js
// - ver docs/CALCULATION_CONFIDENCE_MODEL.md § consistencia de 3 vías
// (Node, SQL, mirror TS).
function metric(value: number, score: number, factorsSummary?: string): MetricWithConfidence<number> {
  const rounded = Math.round((score || 0) * 10) / 10;
  return {
    value,
    confidence_score: rounded,
    confidence_label: getConfidenceLabel(rounded).label,
    confidence_factors_summary: factorsSummary
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<{
      total_duration_minutes: number | bigint | null;
      total_business_minutes: number | bigint | null;
      total_after_hours_minutes: number | bigint | null;
      tasks_total: bigint;
      tasks_with_after_hours: bigint;
      tasks_not_calculable: bigint;
      blank_status_count: bigint;
      hours_confidence_weighted: number | null;
      after_hours_task_confidence_avg: number | null;
    }>(
      `
      SELECT
        COALESCE(SUM(w.duration_minutes), 0) AS total_duration_minutes,
        COALESCE(SUM(w.business_minutes), 0) AS total_business_minutes,
        COALESCE(SUM(w.after_hours_total_minutes), 0) AS total_after_hours_minutes,
        COUNT(*) AS tasks_total,
        COUNT(*) FILTER (WHERE w.is_after_hours_task = true) AS tasks_with_after_hours,
        COUNT(*) FILTER (WHERE w.calculation_status = 'NOT_CALCULABLE') AS tasks_not_calculable,
        COUNT(*) FILTER (WHERE w.calculation_status IS NULL OR w.calculation_status = '') AS blank_status_count,
        SUM(w.confidence_score * w.duration_minutes) / NULLIF(SUM(w.duration_minutes), 0) AS hours_confidence_weighted,
        AVG(w.confidence_score) FILTER (WHERE w.is_after_hours_task = true) AS after_hours_task_confidence_avg
      FROM marts.fieldbeat_working_hours_analysis w
      ${whereClause}
      `,
      pusher.params
    );

    const row = rows[0];
    const totalDurationMinutes = Number(row?.total_duration_minutes ?? 0);
    const totalBusinessMinutes = Number(row?.total_business_minutes ?? 0);
    const totalAfterHoursMinutes = Number(row?.total_after_hours_minutes ?? 0);
    const tasksTotal = Number(row?.tasks_total ?? 0);
    const tasksWithAfterHours = Number(row?.tasks_with_after_hours ?? 0);
    const tasksNotCalculable = Number(row?.tasks_not_calculable ?? 0);
    const blankStatusCount = Number(row?.blank_status_count ?? 0);

    const hoursConfidence = tasksTotal > 0 ? Number(row?.hours_confidence_weighted ?? 0) : 0;
    const afterHoursTaskConfidence = tasksWithAfterHours > 0 ? Number(row?.after_hours_task_confidence_avg ?? 0) : 0;
    const kpi6Confidence = blankStatusCount === 0 ? 95 : Math.max(0, 95 - blankStatusCount * 5);

    const afterHoursRate = totalDurationMinutes > 0 ? totalAfterHoursMinutes / totalDurationMinutes : 0;

    const { businessHoursStatus, holidaysStatus } = await getAfterHoursConfigStatus();

    // Opciones de filtro: siempre sobre el universo completo (sin aplicar
    // los filtros actuales), para que los dropdowns no se vacíen a medida
    // que el usuario filtra - mismo criterio que
    // /api/dashboard/operacional/filters.
    const [clienteRows, tecnicoRows, tipoTareaRows] = await Promise.all([
      runQuery<{ v: string }>(
        `SELECT DISTINCT client_name AS v FROM marts.fieldbeat_working_hours_analysis WHERE client_name IS NOT NULL AND client_name != '' ORDER BY v`
      ),
      runQuery<{ v: string }>(
        `SELECT DISTINCT assigned_to AS v FROM marts.fieldbeat_working_hours_analysis WHERE assigned_to IS NOT NULL AND assigned_to != '' ORDER BY v`
      ),
      runQuery<{ v: string }>(
        `SELECT DISTINCT task_type AS v FROM marts.fieldbeat_working_hours_analysis WHERE task_type IS NOT NULL AND task_type != '' ORDER BY v`
      )
    ]);

    const summary: AfterHoursSummary = {
      businessHoursStatus,
      holidaysStatus,
      filterOptions: {
        clientes: clienteRows.map(r => r.v),
        tecnicos: tecnicoRows.map(r => r.v),
        tiposTarea: tipoTareaRows.map(r => r.v)
      },
      kpis: {
        totalHours: metric(totalDurationMinutes / 60, hoursConfidence),
        businessHours: metric(totalBusinessMinutes / 60, hoursConfidence),
        afterHoursHours: metric(totalAfterHoursMinutes / 60, hoursConfidence),
        afterHoursRate: metric(afterHoursRate, hoursConfidence),
        tasksWithAfterHours: metric(tasksWithAfterHours, afterHoursTaskConfidence),
        tasksNotCalculable: metric(tasksNotCalculable, kpi6Confidence, "Confianza fija, penalizada solo si calculation_status viniera vacío en alguna fila.")
      }
    };

    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
