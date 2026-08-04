import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW } from "@/lib/after-hours-metrics";
import { EQUIPMENT_CANONICAL_CTE, EQUIPMENT_MODEL_RESOLUTION_COLUMNS, equipmentContractCandidatesLateral } from "@/lib/explorer-sql";
import { resolveRowModel } from "@/lib/after-hours-detail-view";
import type {
  AfterHoursCalculationStatus,
  AfterHoursContractualAttemptStatus,
  AfterHoursContractualReasonCode,
  AfterHoursCoverageClassification,
  AfterHoursCoverageReasonCode,
  AfterHoursDataBasis,
  AfterHoursDetailRow
} from "@/types/after-hours";

export const runtime = "nodejs";

// Tabla de detalle de /dashboard/after-hours - clon estructural de
// /api/audit/parts-review/route.ts. Fuente ETAPA 6.6C:
// marts.fieldbeat_working_hours_analysis_current (nunca las tablas GOLD ni
// el mart legado directo). Ver docs/AFTER_HOURS_METRICS.md.
//
// El intervalo expuesto es el intervalo canónico de análisis resuelto por
// el pipeline. La API lo nombra explícitamente analysis_start_time /
// analysis_end_time y adjunta base y fallback; nunca lo presenta como si
// fuera por definición el horario reportado, planificado o una estimación.
//
// §11: data_basis=NONE nunca inventa 0 - las columnas de minutos ya vienen
// NULL desde la vista (COALESCE nunca las convierte a 0, ver sql/082); el
// intervalo canónico se preserva cuando el motivo
// no es terminal - eso ya lo resuelve la vista/Capa C (bicondicional real,
// sql/081: start_time_utc IS NULL <=> reason terminal), esta ruta solo lee
// el resultado, nunca recalcula la condición.
//
// HOTFIX de integridad de datos FieldBeat (auditoría After-Hours, §5 del
// plan): `assigned_to` es y siempre fue el único responsable principal -
// esta vista/pipeline (sql/082) nunca leyó "NOMBRE DEL INGENIERO ADICIONAL",
// así que no puede (ni debe) repartir/multiplicar sus minutos de cobertura
// contractual entre participantes (eso rompería la reconciliación contra el
// mart de contratos, que se mide por tarea, no por persona). `participant_count`
// se agrega acá como campo ADITIVO e INFORMATIVO (fuente única:
// quality.fieldbeat_report_labor_summary, sql/088) para que la fila deje de
// implicar silenciosamente que assigned_to es la única persona que trabajó
// la tarea - nunca altera duration_hours/business_hours/after_hours.

const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  start_time: "w.start_time_local",
  duration: "w.duration_minutes",
  after_hours_rate: "w.after_hours_rate",
  confidence_score: "w.confidence_score"
};

export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);
    const filters = parseAfterHoursFilters(searchParams);

    // Ordenamiento permitido vía allowlist (§14) - nunca interpola la
    // columna del usuario directo.
    const sortKeyRaw = searchParams.get("sortBy") ?? "start_time";
    const sortColumn = ALLOWED_SORT_COLUMNS[sortKeyRaw] ?? ALLOWED_SORT_COLUMNS.start_time;
    const sortDir = searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const baseFrom = `FROM ${AFTER_HOURS_VIEW} w ${whereClause}`;
    // JOIN aditivo únicamente para la fila detallada (participant_count,
    // §5 del hotfix) - baseFrom se preserva sin cambios para el COUNT(*), que
    // no necesita el join (1:1 por fieldbeat_task_id, no altera totalRows).
    const rowsFrom = `FROM ${AFTER_HOURS_VIEW} w LEFT JOIN quality.fieldbeat_report_labor_summary ls ON ls.fieldbeat_task_id = w.fieldbeat_task_id ${whereClause}`;

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n ${baseFrom}`, pusher.params);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const paramsWithPaging = [...pusher.params, pageSize, offset];
    const limitPlaceholder = `$${pusher.params.length + 1}`;
    const offsetPlaceholder = `$${pusher.params.length + 2}`;

    const rows = await runQuery<{
      fieldbeat_task_id: string;
      start_time_local: string | null;
      end_time_local: string | null;
      reported_end_raw: string | null;
      client_name: string | null;
      equipment_internal_ids: string | null;
      assigned_to: string | null;
      task_type: string | null;
      duration_minutes: string | null;
      business_minutes: string | null;
      after_hours_weekday_minutes: string | null;
      weekend_minutes: string | null;
      holiday_minutes: string | null;
      after_hours_rate: number | null;
      calculation_method: string;
      calculation_status: AfterHoursCalculationStatus;
      confidence_score: string | null;
      confidence_label: string | null;
      confidence_factors: string | null;
      data_basis: AfterHoursDataBasis;
      fallback_used: boolean | null;
      coverage_classification: AfterHoursCoverageClassification | null;
      coverage_reason_code: AfterHoursCoverageReasonCode | null;
      contractual_attempt_status: AfterHoursContractualAttemptStatus | null;
      contractual_coverage_classification: AfterHoursCoverageClassification | null;
      contractual_reason_code: AfterHoursContractualReasonCode | null;
      contract_resolution_confidence: string | null;
      contract_resolution_label: string | null;
      confidence_model_version: string | null;
      analysis_interval_basis: AfterHoursDetailRow["analysis_interval_basis"];
      analysis_fallback_used: boolean;
      analysis_fallback_reason: string | null;
      primary_equipment_key: string | null;
      participant_count: string | null;
      resolved_models: string[] | null;
    }>(
      `
        ${EQUIPMENT_CANONICAL_CTE}
        SELECT
          w.fieldbeat_task_id,
          w.start_time_local,
          w.end_time_local,
          w.reported_end_raw,
          w.client_name,
          w.equipment_internal_ids,
          w.assigned_to,
          w.task_type,
          w.duration_minutes,
          w.business_minutes,
          w.after_hours_weekday_minutes,
          w.weekend_minutes,
          w.holiday_minutes,
          w.after_hours_rate,
          w.calculation_method,
          w.calculation_status,
          w.confidence_score,
          w.confidence_label,
          w.confidence_factors,
          w.data_basis,
          w.fallback_used,
          w.coverage_classification,
          w.coverage_reason_code,
          w.contractual_attempt_status,
          w.contractual_coverage_classification,
          w.contractual_reason_code,
          w.contract_resolution_confidence,
          w.contract_resolution_label,
          w.confidence_model_version,
          w.analysis_interval_basis,
          w.analysis_fallback_used,
          w.analysis_fallback_reason,
          w.primary_equipment_key,
          ls.participant_count,
          (
            -- Columna "Modelo" (Sección 14 del encargo NEXUS V3 After-Hours) -
            -- MISMA precedencia estructurada que buildReportDetailQuery
            -- (lib/fieldbeat-report-detail-queries.ts): processed.
            -- fieldbeat_task_equipments primero, texto (w.equipment_internal_ids)
            -- solo como fallback gobernado cuando esa tabla no tiene ninguna
            -- fila para la tarea. DISTINCT non-null - una tarea con 2+ equipos
            -- de modelos distintos conserva ambos (formateados " / " en
            -- lib/explorer-entity-config.ts::formatModelCell), nunca elige uno.
            SELECT ARRAY_AGG(DISTINCT item.model) FILTER (WHERE item.model IS NOT NULL)
            FROM (
              SELECT
                ce.internal_id,
                ${EQUIPMENT_MODEL_RESOLUTION_COLUMNS}
              FROM (
                SELECT te.equipment_internal_id AS raw_internal_id
                FROM processed.fieldbeat_task_equipments te
                WHERE te.fieldbeat_task_id = w.fieldbeat_task_id
                UNION ALL
                SELECT TRIM(unnested.value)
                FROM UNNEST(STRING_TO_ARRAY(COALESCE(w.equipment_internal_ids, ''), '|')) AS unnested(value)
                WHERE TRIM(unnested.value) <> ''
                  AND NOT EXISTS (SELECT 1 FROM processed.fieldbeat_task_equipments te2 WHERE te2.fieldbeat_task_id = w.fieldbeat_task_id)
              ) eq
              JOIN canonical_equipment ce ON ce.internal_id = UPPER(TRIM(eq.raw_internal_id))
              ${equipmentContractCandidatesLateral("ca.fieldbeat_equipment_key = ANY(ce.source_equipment_keys)")}
            ) item
          ) AS resolved_models
        ${rowsFrom}
        ORDER BY ${sortColumn} ${sortDir} NULLS LAST
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      paramsWithPaging
    );

    const mapped: AfterHoursDetailRow[] = rows.map(row => {
      return {
        fieldbeat_task_id: Number(row.fieldbeat_task_id),
        analysis_start_time: row.start_time_local ? String(row.start_time_local) : null,
        analysis_end_time: row.end_time_local ? String(row.end_time_local) : null,
        analysis_interval_basis: row.analysis_interval_basis,
        analysis_fallback_used: row.analysis_fallback_used,
        analysis_fallback_reason: row.analysis_fallback_reason,
        reported_end_raw: row.reported_end_raw,
        client_name: row.client_name,
        equipment_internal_ids: row.equipment_internal_ids,
        assigned_to: row.assigned_to,
        task_type: row.task_type,
        duration_hours: row.duration_minutes !== null ? Number(row.duration_minutes) / 60 : null,
        business_hours: row.business_minutes !== null ? Number(row.business_minutes) / 60 : null,
        after_hours: row.after_hours_weekday_minutes !== null ? Number(row.after_hours_weekday_minutes) / 60 : null,
        weekend_hours: row.weekend_minutes !== null ? Number(row.weekend_minutes) / 60 : null,
        holiday_hours: row.holiday_minutes !== null ? Number(row.holiday_minutes) / 60 : null,
        after_hours_rate: row.after_hours_rate,
        calculation_method: row.calculation_method,
        calculation_status: row.calculation_status,
        confidence_score: row.confidence_score !== null ? Number(row.confidence_score) : null,
        confidence_label: row.confidence_label,
        confidence_factors: row.confidence_factors,
        // Aditivos §4/§11 - nunca ocultan el motivo cuando fallback_used=true.
        data_basis: row.data_basis,
        fallback_used: row.fallback_used,
        coverage_classification: row.coverage_classification,
        coverage_reason_code: row.coverage_reason_code,
        contractual_attempt_status: row.contractual_attempt_status,
        contractual_coverage_classification: row.contractual_coverage_classification,
        contractual_reason_code: row.contractual_reason_code,
        contract_resolution_confidence: row.contract_resolution_confidence !== null ? Number(row.contract_resolution_confidence) : null,
        contract_resolution_label: row.contract_resolution_label,
        confidence_model_version: row.confidence_model_version,
        primary_equipment_key: row.primary_equipment_key,
        ...resolveRowModel(row.resolved_models),
        // Aditivo (auditoría After-Hours §5) - informativo, nunca altera
        // duration_hours/business_hours/after_hours (ver comentario de
        // cabecera del archivo). NULL solo si assigned_to está vacío (la
        // vista de participantes no genera fila sin un responsable principal).
        participant_count: row.participant_count !== null ? Number(row.participant_count) : null
      };
    });

    return NextResponse.json({ rows: mapped, page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
