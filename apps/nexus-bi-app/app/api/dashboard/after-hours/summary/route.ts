import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, confidenceEligibilityCountExprs, confidenceWeightedExpr, populationSelectListSql, sumMinutesExpr } from "@/lib/after-hours-metrics";
import { getAfterHoursConfigStatus } from "@/lib/after-hours-config";
import { getConfidenceLabel } from "@/lib/confidence";
import { AFTER_HOURS_CONTRACTUAL_REASON_CODE_VALUES, AFTER_HOURS_COVERAGE_REASON_CODE_VALUES, AFTER_HOURS_DATA_BASIS_VALUES } from "@/types/after-hours";
import type { AfterHoursDataBasis, AfterHoursSummary, MetricWithConfidence } from "@/types/after-hours";

export const runtime = "nodejs";

// Alimenta los 6 KPIs de /dashboard/after-hours + poblaciones/trazabilidad
// contractual (ETAPA 6.6C). Fuente: marts.fieldbeat_working_hours_analysis_current
// (nunca el mart legado directo, nunca Capa B/C directo - ver sql/082).
//
// Las fórmulas de confianza (KPI 1-4 ponderado por duration_minutes, KPI 5
// promedio simple, KPI 6 antes con blank_status_count) son la re-expresión
// SQL de aggregateMetricConfidence() en src/lib/calculation-confidence.js -
// ver docs/CALCULATION_CONFIDENCE_MODEL.md § consistencia de 3 vías.
// KPI 6 ("tasksNotCalculable") ya no penaliza por blank_status_count: esa
// rama medía calculation_status IS NULL/vacío, un estado que ya no puede
// ocurrir (calculation_status es NOT NULL en Capa C, y la vista lo
// garantiza con COALESCE(...,'NOT_CALCULABLE') incluso en el relleno
// transitorio del mart legado - ver sql/082). Retirada por §6.3.
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

    const { sql: confidenceWeightedSql } = confidenceWeightedExpr("w");
    const { eligible: eligibleCountSql, excluded: excludedCountSql } = confidenceEligibilityCountExprs("w");

    // === Documentación por KPI (§8) ===
    // totalHours: población=calculable_tasks; numerador=SUM(duration_minutes)
    //   FILTER calculable; denominador=60 (conversión a horas); NULL: filas
    //   sin duration_minutes se ignoran (nunca se convierten a 0); NONE:
    //   nunca contribuye (excluido por la población calculable explícita).
    // businessHours: misma población/tratamiento, numerador=SUM(business_minutes).
    //   business_minutes es multi-fuente (§6.1): bajo data_basis=CONTRACTUAL
    //   son los covered_seconds/60 del intento contractual exitoso; bajo
    //   LEGACY_SCHEDULE son los minutos "hábiles" del horario global legado.
    //   Ver byDataBasis abajo para no interpretar todo como contractual.
    // afterHoursHours: numerador=SUM(after_hours_total_minutes), misma población.
    // afterHoursRate: SUM(after_hours_total_minutes)/NULLIF(SUM(duration_minutes),0)
    //   sobre la población calculable - nunca promedio de tasas por fila.
    // tasksWithAfterHours: población=calculable_tasks; numerador=COUNT(*)
    //   FILTER (is_after_hours_task=true); confianza=promedio simple de
    //   confidence_score de esas tareas.
    // tasksNotCalculable: población=total_tasks; numerador=none_tasks
    //   (data_basis='NONE'); confianza=fija (ver kpi6Confidence abajo, ya
    //   sin penalización por blank_status_count).
    const rows = await runQuery<{
      total_duration_minutes: number | string | null;
      total_business_minutes: number | string | null;
      total_after_hours_minutes: number | string | null;
      total_tasks: string;
      calculable_tasks: string;
      not_calculable_tasks: string;
      contractual_tasks: string;
      legacy_schedule_tasks: string;
      none_tasks: string;
      fallback_tasks: string;
      tasks_with_after_hours: string;
      hours_confidence_weighted: number | string | null;
      after_hours_task_confidence_avg: number | string | null;
      confidence_eligible_tasks: string;
      confidence_excluded_tasks: string;
    }>(
      `
      SELECT
        ${sumMinutesExpr("w", "duration_minutes")} AS total_duration_minutes,
        ${sumMinutesExpr("w", "business_minutes")} AS total_business_minutes,
        ${sumMinutesExpr("w", "after_hours_total_minutes")} AS total_after_hours_minutes,
        ${populationSelectListSql("w")},
        COUNT(*) FILTER (WHERE w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE') AND w.is_after_hours_task = true) AS tasks_with_after_hours,
        ${confidenceWeightedSql} AS hours_confidence_weighted,
        AVG(w.confidence_score) FILTER (WHERE w.data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE') AND w.is_after_hours_task = true) AS after_hours_task_confidence_avg,
        ${eligibleCountSql} AS confidence_eligible_tasks,
        ${excludedCountSql} AS confidence_excluded_tasks
      FROM ${AFTER_HOURS_VIEW} w
      ${whereClause}
      `,
      pusher.params
    );

    const row = rows[0];
    const totalDurationMinutes = Number(row?.total_duration_minutes ?? 0);
    const totalBusinessMinutes = Number(row?.total_business_minutes ?? 0);
    const totalAfterHoursMinutes = Number(row?.total_after_hours_minutes ?? 0);
    const totalTasks = Number(row?.total_tasks ?? 0);
    const calculableTasks = Number(row?.calculable_tasks ?? 0);
    const notCalculableTasks = Number(row?.not_calculable_tasks ?? 0);
    const contractualTasks = Number(row?.contractual_tasks ?? 0);
    const legacyScheduleTasks = Number(row?.legacy_schedule_tasks ?? 0);
    const noneTasks = Number(row?.none_tasks ?? 0);
    const fallbackTasks = Number(row?.fallback_tasks ?? 0);
    const tasksWithAfterHours = Number(row?.tasks_with_after_hours ?? 0);
    const confidenceEligibleTasks = Number(row?.confidence_eligible_tasks ?? 0);
    const confidenceExcludedTasks = Number(row?.confidence_excluded_tasks ?? 0);

    const hoursConfidence = calculableTasks > 0 ? Number(row?.hours_confidence_weighted ?? 0) : 0;
    const afterHoursTaskConfidence = tasksWithAfterHours > 0 ? Number(row?.after_hours_task_confidence_avg ?? 0) : 0;
    // KPI 6: confianza fija de 95, sin penalización (blank_status_count
    // retirado por §6.3 - ya no puede ocurrir bajo Capa C NOT NULL).
    const kpi6Confidence = 95;

    const afterHoursRate = totalDurationMinutes > 0 ? totalAfterHoursMinutes / totalDurationMinutes : 0;

    const { businessHoursStatus, holidaysStatus } = await getAfterHoursConfigStatus();

    // Distribución por data_basis (§6.1) - para que el consumidor nunca
    // interprete business_minutes como si fuera siempre contractual.
    const byDataBasisRows = await runQuery<{ data_basis: AfterHoursDataBasis; task_count: string; business_minutes: number | string | null }>(
      `
      SELECT w.data_basis, COUNT(*) AS task_count, SUM(w.business_minutes) AS business_minutes
      FROM ${AFTER_HOURS_VIEW} w
      ${whereClause}
      GROUP BY w.data_basis
      `,
      pusher.params
    );

    // Opciones de filtro: siempre sobre el universo completo (sin aplicar
    // los filtros actuales), para que los dropdowns no se vacíen a medida
    // que el usuario filtra - mismo criterio que
    // /api/dashboard/operacional/filters.
    const [clienteRows, tecnicoRows, tipoTareaRows] = await Promise.all([
      runQuery<{ v: string }>(`SELECT DISTINCT client_name AS v FROM ${AFTER_HOURS_VIEW} WHERE client_name IS NOT NULL AND client_name != '' ORDER BY v`),
      runQuery<{ v: string }>(`SELECT DISTINCT assigned_to AS v FROM ${AFTER_HOURS_VIEW} WHERE assigned_to IS NOT NULL AND assigned_to != '' ORDER BY v`),
      runQuery<{ v: string }>(`SELECT DISTINCT task_type AS v FROM ${AFTER_HOURS_VIEW} WHERE task_type IS NOT NULL AND task_type != '' ORDER BY v`)
    ]);

    const summary: AfterHoursSummary = {
      businessHoursStatus,
      holidaysStatus,
      total_tasks: totalTasks,
      calculable_tasks: calculableTasks,
      not_calculable_tasks: notCalculableTasks,
      contractual_tasks: contractualTasks,
      legacy_schedule_tasks: legacyScheduleTasks,
      none_tasks: noneTasks,
      fallback_tasks: fallbackTasks,
      confidence_eligible_tasks: confidenceEligibleTasks,
      confidence_excluded_tasks: confidenceExcludedTasks,
      filterOptions: {
        clientes: clienteRows.map(r => r.v),
        tecnicos: tecnicoRows.map(r => r.v),
        tiposTarea: tipoTareaRows.map(r => r.v),
        dataBases: [...AFTER_HOURS_DATA_BASIS_VALUES],
        coverageReasonCodes: [...AFTER_HOURS_COVERAGE_REASON_CODE_VALUES],
        contractualReasonCodes: [...AFTER_HOURS_CONTRACTUAL_REASON_CODE_VALUES]
      },
      kpis: {
        totalHours: metric(totalDurationMinutes / 60, hoursConfidence),
        businessHours: metric(totalBusinessMinutes / 60, hoursConfidence),
        afterHoursHours: metric(totalAfterHoursMinutes / 60, hoursConfidence),
        afterHoursRate: metric(afterHoursRate, hoursConfidence),
        tasksWithAfterHours: metric(tasksWithAfterHours, afterHoursTaskConfidence),
        tasksNotCalculable: metric(noneTasks, kpi6Confidence, "Confianza fija (95): calculation_status ya no puede ser NULL/vacío en Capa C.")
      },
      byDataBasis: byDataBasisRows.map(r => ({
        data_basis: r.data_basis,
        task_count: Number(r.task_count),
        business_minutes: r.business_minutes !== null ? Number(r.business_minutes) : null
      }))
    };

    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
