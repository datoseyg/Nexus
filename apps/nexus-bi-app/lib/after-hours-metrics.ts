// Helpers SQL centralizados para /api/dashboard/after-hours/* (ETAPA 6.6C).
// Fuente única del mart, expresiones de población, tasa y confianza
// NULL-safe - evita repetir estos fragmentos en cada route.ts (§13).
//
// Regla de poblaciones (§5): total_tasks = todas las filas filtradas;
// calculable_tasks = data_basis IN ('CONTRACTUAL','LEGACY_SCHEDULE');
// las métricas de minutos/tasas se calculan SOLO sobre filas calculables
// (en la práctica esto ya es automático: covered/business/after_hours_*
// son NULL para data_basis='NONE' en la vista, sql/082, así que SUM()
// los ignora sin necesidad de un filtro WHERE explícito adicional -pero
// los CONTEOS de tareas si necesitan distinguir explícitamente la
// población, de ahí estas expresiones).
//
// ============================================================================
// AUDITORÍA obligatoria de After-Hours vs. participantes 0..N (HOTFIX de
// integridad de datos FieldBeat, post-Phase 6) - tabla real, evidencia
// directa de sql/082 + processed.fieldbeat_tasks, nunca supuesta.
// ============================================================================
//
// Hallazgo estructural único (aplica a los 4 endpoints, confirmado leyendo
// sql/082 línea por línea): AFTER_HOURS_VIEW tiene GRANO 1 fila = 1
// fieldbeat_task_id, y su columna `assigned_to` es
// `COALESCE(c.assigned_to, l.assigned_to)` -SIEMPRE proviene de
// processed.fieldbeat_tasks.assigned_to (Capa C/mart legado la heredan sin
// tocarla). Esta vista y todo su linaje (task-coverage-builder.js, Capa
// B/C, contratos/feriados) NUNCA leyeron "NOMBRE DEL INGENIERO ADICIONAL"
// -no existe, en ninguna capa de este pipeline, el concepto de participante
// adicional. Es un linaje de cálculo COMPLETAMENTE separado del de
// quality.fieldbeat_report_labor_summary (sql/088): éste mide MINUTOS DE
// COBERTURA CONTRACTUAL de la ventana agendada de una tarea (¿cayó dentro
// o fuera del horario contratado?), no minutos de trabajo físico de una o
// más personas -son dos preguntas de negocio distintas sobre el tiempo,
// nunca deben mezclarse (mismo principio que separa actualReportDurationMinutes
// de scheduledEstimateMinutes en FieldbeatLaborSummary).
//
// | Endpoint/métrica     | Grano actual        | Qué significa "técnico"        | Usa solo assigned_to | Mide eventos o horas-persona                              | Debe cambiar |
// |-----------------------|---------------------|----------------------------------|:---:|--------------------------------------------------------------|:---:|
// | summary (KPIs 1-6)    | Agregado global (todas las tareas filtradas) | N/A -no agrupa por técnico, salvo `distinct_technicians` (COUNT DISTINCT assigned_to) | Sí, solo en distinct_technicians | Totales = SUM de minutos de cobertura por REPORTE, nunca por persona | Cálculo NO -totales deben permanecer a grano-reporte. Solo se documenta/rotula `distinct_technicians` como "responsables principales", nunca "todas las personas que trabajaron". |
// | by-technician         | 1 fila por fieldbeat_task_id, agrupado por assigned_to | El único responsable principal (assigned_to) | Sí, exclusivamente | Horas de COBERTURA CONTRACTUAL atribuidas al responsable, no horas-persona de labor física | Cálculo NO (repartir/duplicar minutos de cobertura por participante rompería la reconciliación contra el mart de contratos, que se mide por tarea). Copy/label SÍ: "¿Qué técnicos responsables registran más actividad?" (antes ambiguo "¿Qué técnicos...?"). |
// | technician-client     | 1 fila por (fieldbeat_task_id, assigned_to, client_name) | Mismo assigned_to, en pares con cliente | Sí, exclusivamente | Igual que by-technician (ranking de pares) | Mismo criterio que by-technician: cálculo sin cambios, copy clarificado ("técnicos responsables"). |
// | detail                | 1 fila = 1 fieldbeat_task_id (tabla paginada, sin agregación por persona) | assigned_to mostrado tal cual, por fila | Sí | Grano-evento/tarea (duración cronológica de ESA tarea) -nunca agrega por persona | Cálculo NO (calza con la regla de decisión: mide solo duración cronológica del evento, conserva grano-reporte). Aditivo SÍ: `participant_count` (fuente quality.fieldbeat_report_labor_summary, sql/088) expuesto como campo informativo -nunca altera duration_hours/business_hours/after_hours- para que la fila deje de implicar silenciosamente que assigned_to es la única persona que trabajó la tarea. |
//
// Conclusión (evidencia, no supuesta): ninguno de los 4 endpoints necesita
// cambiar su ARITMÉTICA de horas -el dominio After-Hours mide cobertura
// contractual por tarea, un dominio genuinamente distinto de "cuántas
// personas trabajaron" (ese dominio es quality.fieldbeat_report_labor_summary,
// sql/088). Las horas de un participante adicional (ej. Alexis Acevedo en
// el 3453) NO faltan de After-Hours por un bug -After-Hours nunca las tuvo
// en su modelo, por diseño de su propio linaje de cálculo, y sumarlas
// inventaría una atribución que ningún dato real respalda. Lo que SÍ era un
// defecto real (silencioso, no documentado) es que el copy/label de 3 de
// los 4 endpoints ("¿Qué técnicos...?", "Técnicos involucrados", "Técnico"
// en filtro/drawer/tabla) podía leerse como si assigned_to representara a
// TODAS las personas que trabajaron la tarea -corregido acá (labels
// renombrados a "responsable(s) principal(es)"/"Técnico responsable") + un
// campo aditivo `participant_count` en `detail` (nunca en los 3 rankings
// agregados, donde repartir por participante sí corrompería el total).

import type { AfterHoursByDimensionRow, AfterHoursPopulationCounts } from "../types/after-hours";
import { getConfidenceLabel } from "./confidence";

export const AFTER_HOURS_VIEW = "marts.fieldbeat_working_hours_analysis_current";

export function col(alias: string, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

export function calculableExpr(alias: string): string {
  return `${col(alias, "data_basis")} IN ('CONTRACTUAL', 'LEGACY_SCHEDULE')`;
}

/**
 * Expresiones COUNT(*) FILTER(...) para las 7 poblaciones estándar
 * (§5/§8/§9). not_calculable_tasks y none_tasks son numéricamente
 * idénticas por construcción (CHECK real en sql/081:
 * (data_basis='NONE') = (calculation_status='NOT_CALCULABLE')) - se
 * exponen ambos nombres porque §8 (summary) y §5/§9 (poblaciones
 * generales) usan terminología distinta para la misma cosa.
 */
export function populationCountExprs(alias: string): Record<keyof AfterHoursPopulationCounts, string> {
  const dataBasis = col(alias, "data_basis");
  return {
    total_tasks: `COUNT(*)`,
    calculable_tasks: `COUNT(*) FILTER (WHERE ${calculableExpr(alias)})`,
    not_calculable_tasks: `COUNT(*) FILTER (WHERE ${dataBasis} = 'NONE')`,
    contractual_tasks: `COUNT(*) FILTER (WHERE ${dataBasis} = 'CONTRACTUAL')`,
    legacy_schedule_tasks: `COUNT(*) FILTER (WHERE ${dataBasis} = 'LEGACY_SCHEDULE')`,
    none_tasks: `COUNT(*) FILTER (WHERE ${dataBasis} = 'NONE')`,
    fallback_tasks: `COUNT(*) FILTER (WHERE ${col(alias, "fallback_used")} = true)`
  };
}

export function populationSelectListSql(alias: string): string {
  const exprs = populationCountExprs(alias);
  return Object.entries(exprs)
    .map(([name, expr]) => `${expr} AS ${name}`)
    .join(",\n        ");
}

/**
 * Agregación de tasa: SUM/SUM sobre la misma población, nunca promedio de
 * tasas por fila (§9: "No promediar tasas por fila"). Toma NOMBRES de
 * columna (no expresiones ya agregadas) y aplica el mismo filtro de
 * población calculable que sumMinutesExpr a ambos lados -evita anidar
 * SUM(SUM(...)) si se compusiera con sumMinutesExpr, y mantiene numerador
 * y denominador en la misma población. NULLIF evita división por cero
 * cuando la población filtrada no tiene minutos.
 */
export function rateExpr(alias: string, numeratorColumn: string, denominatorColumn: string): string {
  const filterClause = `FILTER (WHERE ${calculableExpr(alias)})`;
  return `SUM(${col(alias, numeratorColumn)}) ${filterClause} / NULLIF(SUM(${col(alias, denominatorColumn)}) ${filterClause}, 0)`;
}

/**
 * Confianza agregada NULL-safe (§6.2): numerador y denominador comparten
 * EXACTAMENTE el mismo filtro de elegibilidad
 * (calculable AND confidence_score IS NOT NULL AND duration_minutes IS
 * NOT NULL AND duration_minutes > 0), aplicado como FILTER (WHERE ...) en
 * AMBOS SUM - antes, el denominador sumaba duration_minutes de filas cuyo
 * confidence_score era NULL, sesgando el promedio hacia abajo sin que el
 * numerador reflejara esas filas. Nunca convierte NULL a 0.
 *
 * Incluye calculableExpr explícitamente: existe un caso real donde
 * data_basis='NONE' con intervalo temporal resuelto (ambos intentos de
 * cobertura fallaron, pero start/end/duration se conservan,
 * task-coverage-builder.js branch final) SÍ trae confidence_score y
 * duration_minutes no nulos -sin este filtro, esa tarea NO calculable se
 * colaría en el promedio de confianza de las tareas calculables.
 */
export function confidenceWeightedExpr(alias: string): { sql: string; eligibleExpr: string } {
  const score = col(alias, "confidence_score");
  const duration = col(alias, "duration_minutes");
  const eligibleExpr = `${calculableExpr(alias)} AND ${score} IS NOT NULL AND ${duration} IS NOT NULL AND ${duration} > 0`;
  const sql = `SUM(${score} * ${duration}) FILTER (WHERE ${eligibleExpr}) / NULLIF(SUM(${duration}) FILTER (WHERE ${eligibleExpr}), 0)`;
  return { sql, eligibleExpr };
}

export function confidenceEligibilityCountExprs(alias: string): { eligible: string; excluded: string } {
  const { eligibleExpr } = confidenceWeightedExpr(alias);
  return {
    eligible: `COUNT(*) FILTER (WHERE ${eligibleExpr})`,
    // "Excluidas" se cuenta solo dentro de la población calculable -una
    // fila NONE nunca tuvo score que perder, no es una "exclusión" real.
    excluded: `COUNT(*) FILTER (WHERE ${calculableExpr(alias)} AND NOT (${eligibleExpr}))`
  };
}

/**
 * Suma de una columna de minutos, restringida EXPLÍCITAMENTE a la
 * población calculable (§5). No basta con dejar que SUM() ignore NULLs
 * por su cuenta: un data_basis='NONE' cuyo intervalo temporal SÍ se
 * resolvió (pero cuya cobertura falló en ambos intentos) conserva
 * duration_minutes NO NULO en la vista (task-coverage-builder.js
 * preserva start/end/duration incluso en el branch NONE final) -sin este
 * filtro explícito, esa fila filtraría minutos de una tarea NO calculable
 * hacia un total que se supone solo cuenta trabajo calculable. Las
 * columnas de cobertura (business_minutes, after_hours_*) sí son NULL en
 * TODOS los casos NONE (por construcción), pero duration_minutes no lo
 * es siempre -de ahí que este filtro se aplique parejo a toda columna,
 * por seguridad y por claridad de intención, no por necesidad dispar
 * columna a columna. Sin COALESCE a nivel de fila (§9: "se agregan solo
 * con valores no NULL") -el COALESCE(...,0) final, si hace falta, se
 * aplica en JS al leer el agregado, nunca acá.
 */
export function sumMinutesExpr(alias: string, columnName: string): string {
  return `SUM(${col(alias, columnName)}) FILTER (WHERE ${calculableExpr(alias)})`;
}

/**
 * Bloque SELECT compartido por los 4 endpoints agregados (by-client,
 * by-period, by-task-type, by-technician, §9/§13) - evita repetir el
 * mismo bloque de agregación 4 veces. Se concatena junto con el `key`
 * propio de cada endpoint (client_name/período/task_type/assigned_to).
 */
export function groupedAggregateSelectSql(alias: string): string {
  const { sql: confidenceWeightedSql } = confidenceWeightedExpr(alias);
  const { eligible, excluded } = confidenceEligibilityCountExprs(alias);
  return `
        ${populationSelectListSql(alias)},
        ${sumMinutesExpr(alias, "duration_minutes")} AS total_minutes,
        ${sumMinutesExpr(alias, "business_minutes")} AS business_minutes,
        ${sumMinutesExpr(alias, "after_hours_total_minutes")} AS after_hours_minutes,
        COUNT(*) FILTER (WHERE ${calculableExpr(alias)} AND ${col(alias, "is_after_hours_task")} = true) AS tasks_with_after_hours,
        ${confidenceWeightedSql} AS confidence_weighted,
        ${eligible} AS confidence_eligible_tasks,
        ${excluded} AS confidence_excluded_tasks`;
}

export interface GroupedAggregateQueryRow {
  key: string;
  extra?: string | null;
  total_tasks: string;
  calculable_tasks: string;
  not_calculable_tasks: string;
  contractual_tasks: string;
  legacy_schedule_tasks: string;
  none_tasks: string;
  fallback_tasks: string;
  total_minutes: number | string | null;
  business_minutes: number | string | null;
  after_hours_minutes: number | string | null;
  tasks_with_after_hours: string;
  confidence_weighted: number | string | null;
  confidence_eligible_tasks: string;
  confidence_excluded_tasks: string;
}

// Fila cruda de agregado sin la parte de identidad (key/extra) - lo que
// comparten TODAS las agregaciones sobre groupedAggregateSelectSql(),
// tengan una key simple (by-client/by-technician/by-task-type/by-weekday/
// technician-client, vía mapGroupedRow) o una identidad compuesta que no
// cabe en un string único (weekday-hour, vía mapWeekdayHourRow en
// lib/after-hours-weekday-view.ts). Extraído para que ETAPA 6.6D no tenga
// que inventarle a mapGroupedRow una key/extra ficticia solo para
// reutilizar su aritmética (ver mapWeekdayHourRow).
export type AggregateMetricsRow = Omit<GroupedAggregateQueryRow, "key" | "extra">;
export type AggregateMetrics = Omit<AfterHoursByDimensionRow, "key" | "extra">;

/**
 * Aritmética compartida de redondeo/conversión de un bloque
 * groupedAggregateSelectSql() - centraliza minutos->horas, tasa SUM/SUM y
 * el mapeo de confianza ponderada. Nunca se llama directamente desde un
 * route.ts; siempre a través de mapGroupedRow() (identidad simple) o de un
 * mapper con identidad propia como mapWeekdayHourRow().
 */
export function mapAggregateMetrics(row: AggregateMetricsRow): AggregateMetrics {
  const totalMinutes = Number(row.total_minutes ?? 0);
  const afterHoursMinutes = Number(row.after_hours_minutes ?? 0);
  const businessMinutes = row.business_minutes !== null ? Number(row.business_minutes) : 0;
  const confidenceWeighted = row.confidence_weighted !== null ? Number(row.confidence_weighted) : 0;
  const score = Math.round(confidenceWeighted);
  const totalTasks = Number(row.total_tasks ?? 0);

  return {
    total_tasks: totalTasks,
    calculable_tasks: Number(row.calculable_tasks ?? 0),
    not_calculable_tasks: Number(row.not_calculable_tasks ?? 0),
    contractual_tasks: Number(row.contractual_tasks ?? 0),
    legacy_schedule_tasks: Number(row.legacy_schedule_tasks ?? 0),
    none_tasks: Number(row.none_tasks ?? 0),
    fallback_tasks: Number(row.fallback_tasks ?? 0),
    total_hours: Math.round((totalMinutes / 60) * 100) / 100,
    business_hours: Math.round((businessMinutes / 60) * 100) / 100,
    after_hours_total_hours: Math.round((afterHoursMinutes / 60) * 100) / 100,
    // SUM/SUM sobre la misma población calculable, nunca promedio de tasas
    // por fila (§9).
    after_hours_rate: totalMinutes > 0 ? afterHoursMinutes / totalMinutes : 0,
    tasks_total: totalTasks,
    tasks_with_after_hours: Number(row.tasks_with_after_hours ?? 0),
    confidence_score: score,
    confidence_label: getConfidenceLabel(score).label,
    average_confidence: row.confidence_weighted !== null ? confidenceWeighted : null,
    confidence_eligible_tasks: Number(row.confidence_eligible_tasks ?? 0),
    confidence_excluded_tasks: Number(row.confidence_excluded_tasks ?? 0)
  };
}

/**
 * Mapea una fila cruda del bloque groupedAggregateSelectSql() a la forma
 * de respuesta pública AfterHoursByDimensionRow - centraliza el redondeo y
 * las conversiones de tipo, usado por los endpoints con identidad simple
 * (by-client, by-period, by-task-type, by-technician, by-weekday,
 * technician-client - éste último con key=técnico/extra=cliente, mismo
 * patrón que by-client con key=cliente/extra=rut).
 */
export function mapGroupedRow(row: GroupedAggregateQueryRow): AfterHoursByDimensionRow {
  return {
    key: row.key,
    extra: row.extra ?? null,
    ...mapAggregateMetrics(row)
  };
}

/**
 * Branching temporal del endpoint detail (§6.4), extraído como función
 * pura para poder testearlo sin base de datos. Comportamiento preservado
 * exacto del mart legado: EXACT_REPORTED_START_END muestra el string
 * crudo reportado por el técnico (reported_end_raw); cualquier otro
 * método usa el fin normalizado por el pipeline (antes
 * estimated_end_time_local en el mart legado, ahora end_time_local en la
 * vista - ver sql/082, mismo valor semántico, columna renombrada).
 */
export function resolveEstimatedEndTime(calculationMethod: string, reportedEndRaw: string | null, endTimeLocal: string | null): string | null {
  if (calculationMethod === "EXACT_REPORTED_START_END") return reportedEndRaw;
  return endTimeLocal ? String(endTimeLocal) : null;
}
