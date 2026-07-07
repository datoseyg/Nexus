import { type Env, jsonResponse, errorResponse } from "../_shared";
import { buildConditions, parseAfterHoursFilters, getConfidenceLabel } from "./_filters";

const TABLE = "marts_fieldbeat_working_hours_analysis";

function metric(value: number, score: number, factorsSummary?: string) {
  const rounded = Math.round((score || 0) * 10) / 10;
  return {
    value,
    confidence_score: rounded,
    confidence_label: getConfidenceLabel(rounded).label,
    confidence_factors_summary: factorsSummary
  };
}

// GET /api/d1/after-hours/summary?client=&technician=&taskType=&from=&to=&confidenceLevel=&onlyAfterHours=&onlyLowConfidence=
// Equivalente D1 (en vivo, mismos filtros) de /api/dashboard/after-hours/summary
// en modo local-duckdb - ver docs/CLOUDFLARE_D1_MIGRATION.md y
// docs/AFTER_HOURS_METRICS.md / docs/CALCULATION_CONFIDENCE_MODEL.md.
//
// businessHoursStatus/holidaysStatus no están disponibles en este modo
// (Cloudflare Workers no tiene acceso a filesystem para leer
// data/config/business-hours.json) - se devuelven fijos; ningún componente
// de la UI los renderiza hoy (ver AfterHoursShell.tsx/AfterHoursKpiGrid.tsx).
export const onRequestGet: PagesFunction<Env> = async context => {
  try {
    const url = new URL(context.request.url);
    const filters = parseAfterHoursFilters(url);
    const { where, params } = buildConditions(filters);

    interface Row {
      total_duration_minutes: number | null;
      total_business_minutes: number | null;
      total_after_hours_minutes: number | null;
      tasks_total: number;
      tasks_with_after_hours: number;
      tasks_not_calculable: number;
      blank_status_count: number;
      hours_confidence_weighted: number | null;
      after_hours_task_confidence_avg: number | null;
    }

    const result = await context.env.DB
      .prepare(
        `SELECT
           COALESCE(SUM(duration_minutes), 0) AS total_duration_minutes,
           COALESCE(SUM(business_minutes), 0) AS total_business_minutes,
           COALESCE(SUM(after_hours_total_minutes), 0) AS total_after_hours_minutes,
           COUNT(*) AS tasks_total,
           SUM(CASE WHEN is_after_hours_task = 1 THEN 1 ELSE 0 END) AS tasks_with_after_hours,
           SUM(CASE WHEN calculation_status = 'NOT_CALCULABLE' THEN 1 ELSE 0 END) AS tasks_not_calculable,
           SUM(CASE WHEN calculation_status IS NULL OR calculation_status = '' THEN 1 ELSE 0 END) AS blank_status_count,
           SUM(confidence_score * duration_minutes) / NULLIF(SUM(duration_minutes), 0) AS hours_confidence_weighted,
           AVG(CASE WHEN is_after_hours_task = 1 THEN confidence_score END) AS after_hours_task_confidence_avg
         FROM ${TABLE}
         ${where}`
      )
      .bind(...params)
      .all<Row>();

    const row = result.results[0];
    const totalDurationMinutes = row?.total_duration_minutes ?? 0;
    const totalBusinessMinutes = row?.total_business_minutes ?? 0;
    const totalAfterHoursMinutes = row?.total_after_hours_minutes ?? 0;
    const tasksTotal = row?.tasks_total ?? 0;
    const tasksWithAfterHours = row?.tasks_with_after_hours ?? 0;
    const tasksNotCalculable = row?.tasks_not_calculable ?? 0;
    const blankStatusCount = row?.blank_status_count ?? 0;

    const hoursConfidence = tasksTotal > 0 ? (row?.hours_confidence_weighted ?? 0) : 0;
    const afterHoursTaskConfidence = tasksWithAfterHours > 0 ? (row?.after_hours_task_confidence_avg ?? 0) : 0;
    const kpi6Confidence = blankStatusCount === 0 ? 95 : Math.max(0, 95 - blankStatusCount * 5);
    const afterHoursRate = totalDurationMinutes > 0 ? totalAfterHoursMinutes / totalDurationMinutes : 0;

    const [clientRows, technicianRows, taskTypeRows] = await Promise.all([
      context.env.DB
        .prepare(`SELECT DISTINCT client_name AS v FROM ${TABLE} WHERE client_name IS NOT NULL AND client_name != '' ORDER BY v`)
        .all<{ v: string }>(),
      context.env.DB
        .prepare(`SELECT DISTINCT assigned_to AS v FROM ${TABLE} WHERE assigned_to IS NOT NULL AND assigned_to != '' ORDER BY v`)
        .all<{ v: string }>(),
      context.env.DB
        .prepare(`SELECT DISTINCT task_type AS v FROM ${TABLE} WHERE task_type IS NOT NULL AND task_type != '' ORDER BY v`)
        .all<{ v: string }>()
    ]);

    return jsonResponse({
      businessHoursStatus: "NOT_AVAILABLE_IN_D1_MODE",
      holidaysStatus: "NOT_AVAILABLE_IN_D1_MODE",
      filterOptions: {
        clientes: clientRows.results.map(r => r.v),
        tecnicos: technicianRows.results.map(r => r.v),
        tiposTarea: taskTypeRows.results.map(r => r.v)
      },
      kpis: {
        totalHours: metric(totalDurationMinutes / 60, hoursConfidence),
        businessHours: metric(totalBusinessMinutes / 60, hoursConfidence),
        afterHoursHours: metric(totalAfterHoursMinutes / 60, hoursConfidence),
        afterHoursRate: metric(afterHoursRate, hoursConfidence),
        tasksWithAfterHours: metric(tasksWithAfterHours, afterHoursTaskConfidence),
        tasksNotCalculable: metric(
          tasksNotCalculable,
          kpi6Confidence,
          "Confianza fija, penalizada solo si calculation_status viniera vacío en alguna fila."
        )
      }
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Error desconocido");
  }
};
