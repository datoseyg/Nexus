// Bandeja definitiva de "Reportes" (Phase 4) - reemplaza el par transitorio
// FieldbeatDetailTable.tsx / GET /api/dashboard/fieldbeat/detail (Phase 3
// §10, deuda documentada). Reutiliza la MISMA base filtrada
// (quality.fieldbeat_report_quality + buildFieldbeatQualityConditions) que
// overview/quality, para que "Excepciones" bajo un filtro dado reconcilie
// exactamente con KPI6.affectedReports bajo el mismo filtro: ambos son
// "reportes en quality.fieldbeat_report_quality que matchean el filtro Y
// tienen >=1 fila en quality.fieldbeat_report_inconsistencies", la MISMA
// condición expresada una sola vez acá (join contra
// quality.fieldbeat_report_primary_inconsistency, que ya es 1 fila por
// reporte vía DISTINCT ON).
import { createParamPusher } from "./dashboard-filters";
import { buildFieldbeatQualityConditions, type FieldbeatQualityFilters } from "./fieldbeat-quality-filters";
import type { FieldbeatReportRow, FieldbeatReportsDirection, FieldbeatReportsSortKey, FieldbeatReportsView } from "@/types/fieldbeat-reports";

export const REPORTS_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_REPORTS_PAGE_SIZE = 25;
export const MAX_EXPORT_ROWS = 20000;

/** Phase 5 preflight §2.3 - límite explícito: un universo filtrado mayor a
 * MAX_EXPORT_ROWS se rechaza (413), nunca se entrega como CSV truncado
 * presentado como completo. Extraída como función pura para poder fijar el
 * límite exacto sin depender de un fixture real de 20.001 filas. */
export function isExportOverLimit(trueTotalRows: number): boolean {
  return trueTotalRows > MAX_EXPORT_ROWS;
}

export const REPORTS_SORT_KEYS: readonly FieldbeatReportsSortKey[] = ["date", "severity", "client", "technician", "taskType", "id"];
export const REPORTS_VIEWS: readonly FieldbeatReportsView[] = ["exceptions", "all"];
export const REPORTS_DIRECTIONS: readonly FieldbeatReportsDirection[] = ["asc", "desc"];

const MAX_SEARCH_LENGTH = 40;

export function isValidReportsPageSize(value: number): value is (typeof REPORTS_PAGE_SIZES)[number] {
  return (REPORTS_PAGE_SIZES as readonly number[]).includes(value);
}

export function parseReportsPageSize(raw: string | null): number {
  const parsed = Number(raw);
  return isValidReportsPageSize(parsed) ? parsed : DEFAULT_REPORTS_PAGE_SIZE;
}

export function parseReportsPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function parseReportsView(raw: string | null): FieldbeatReportsView {
  return raw === "all" ? "all" : "exceptions";
}

export function parseReportsSort(raw: string | null): FieldbeatReportsSortKey {
  return (REPORTS_SORT_KEYS as readonly string[]).includes(raw ?? "") ? (raw as FieldbeatReportsSortKey) : "date";
}

export function parseReportsDirection(raw: string | null): FieldbeatReportsDirection {
  return raw === "asc" ? "asc" : "desc";
}

/** Búsqueda exacta-o-prefijo sobre el ID (solo dígitos; cualquier otro
 * caracter se recorta - fieldbeat_task_id es BIGINT, nunca alfanumérico). */
export function parseReportsSearch(raw: string | null): string | null {
  if (!raw) return null;
  const digitsOnly = raw.trim().replace(/[^0-9]/g, "").slice(0, MAX_SEARCH_LENGTH);
  return digitsOnly.length > 0 ? digitsOnly : null;
}

const SORT_COLUMN_SQL: Record<FieldbeatReportsSortKey, string> = {
  date: "fieldbeat_task_date",
  severity: "severity_rank",
  client: "client_name",
  technician: "technician_names",
  taskType: "task_type",
  id: "fieldbeat_task_id"
};

// Alta=3..Advertencia=0, limpio(NULL)=-1 - INVERTIDO respecto al orden de
// severidad usado en KPI6/taxonomía (donde Alta=rango 0 "mejor"). Acá el
// número más alto = más severo a propósito, para que direction="desc"
// (default de la bandeja) traiga los reportes más graves primero de forma
// intuitiva vía un ORDER BY genérico (mismo mecanismo que date/client/...),
// sin una rama especial "si sort=severity invertir direction". Bug real
// encontrado en Phase 4: con Alta=0/ELSE=4 (mismo sentido que
// SEVERITY_RANK de fieldbeat-inconsistency-taxonomy.ts), direction="desc"
// traía los reportes LIMPIOS primero (rank 4, el más alto) en vez de los
// de severidad Alta - verificado con un reporte real vía integration test.
function severityRankCaseExpr(): string {
  return `CASE pi.severity WHEN 'Alta' THEN 3 WHEN 'Media' THEN 2 WHEN 'Baja' THEN 1 WHEN 'Advertencia' THEN 0 ELSE -1 END`;
}

export interface BuildReportsQueryOptions {
  filters: FieldbeatQualityFilters;
  view: FieldbeatReportsView;
  search: string | null;
  sort: FieldbeatReportsSortKey;
  direction: FieldbeatReportsDirection;
}

/**
 * CTE `filtered` compartida por el listado paginado y el export CSV -
 * ninguno de los dos re-implementa el WHERE/JOIN por su cuenta. El
 * llamador agrega LIMIT/OFFSET (listado, + COUNT(*) OVER() para
 * metadata en 1 solo round-trip) o ninguno (export, hasta MAX_EXPORT_ROWS).
 */
export function buildReportsFilteredCte({ filters, view, search, sort, direction }: BuildReportsQueryOptions): {
  cteSql: string;
  orderBySql: string;
  params: unknown[];
} {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions(filters, "u", pusher);

  if (search) {
    conditions.push(`(CAST(u.fieldbeat_task_id AS TEXT) = ${pusher.push(search)} OR CAST(u.fieldbeat_task_id AS TEXT) LIKE ${pusher.push(`${search}%`)})`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const viewCondition = view === "exceptions" ? "WHERE primary_code IS NOT NULL" : "";
  const dir = direction === "asc" ? "ASC" : "DESC";
  const sortColumn = SORT_COLUMN_SQL[sort];
  // Empate estable por id (nunca "orden indefinido" entre páginas) - mismo
  // principio que crossings-pivot (ORDER BY ... , row_key ASC).
  const orderBySql = `ORDER BY ${sortColumn} ${dir} NULLS LAST, fieldbeat_task_id ASC`;

  const cteSql = `
    filtered AS MATERIALIZED (
      SELECT
        u.fieldbeat_task_id,
        u.fieldbeat_task_date,
        u.client_name,
        u.technician_names,
        u.equipment_internal_ids,
        u.task_type,
        u.origen,
        u.report_quality_status,
        u.has_ticket_reported,
        u.ticket_accessible,
        pi.code AS primary_code,
        pi.severity AS primary_severity,
        ${severityRankCaseExpr()} AS severity_rank,
        (
          SELECT COALESCE(json_agg(json_build_object('code', ri.code, 'severity', ri.severity) ORDER BY ri.priority_order), '[]'::json)
          FROM quality.fieldbeat_report_inconsistencies ri
          WHERE ri.fieldbeat_task_id = u.fieldbeat_task_id
        ) AS findings,
        -- HOTFIX de integridad de datos FieldBeat (Stage 10, columna
        -- aditiva) - participantes adicionales (nunca el responsable
        -- principal, ya cubierto por technician_names/u.technician_names).
        -- Fuente ÚNICA canónica: quality.fieldbeat_report_participants
        -- (sql/088), nunca reimplementa acá la lógica de resolución.
        (
          SELECT COALESCE(json_agg(pp.raw_name ORDER BY pp.raw_name), '[]'::json)
          FROM quality.fieldbeat_report_participants pp
          WHERE pp.fieldbeat_task_id = u.fieldbeat_task_id AND pp.is_primary = false
        ) AS additional_participants
      FROM quality.fieldbeat_report_quality u
      LEFT JOIN quality.fieldbeat_report_primary_inconsistency pi ON pi.fieldbeat_task_id = u.fieldbeat_task_id
      ${whereSql}
    ),
    view_filtered AS MATERIALIZED (
      SELECT * FROM filtered
      ${viewCondition}
    )
  `;

  return { cteSql, orderBySql, params: pusher.params };
}

interface ReportsQueryRow {
  fieldbeat_task_id: string;
  fieldbeat_task_date: string | null;
  client_name: string | null;
  technician_names: string | null;
  equipment_internal_ids: string | null;
  task_type: string | null;
  origen: string | null;
  report_quality_status: string | null;
  has_ticket_reported: boolean;
  ticket_accessible: boolean | null;
  primary_code: string | null;
  primary_severity: string | null;
  findings: Array<{ code: string; severity: string }>;
  additional_participants: string[] | null;
}

export function shapeReportRow(row: ReportsQueryRow): FieldbeatReportRow {
  return {
    fieldbeatTaskId: row.fieldbeat_task_id,
    fecha: row.fieldbeat_task_date,
    cliente: row.client_name,
    // Responsable principal - NUNCA alterado por additionalParticipants.
    tecnico: row.technician_names,
    equipo: row.equipment_internal_ids,
    tipoTarea: row.task_type,
    origen: row.origen,
    reportQualityStatus: row.report_quality_status,
    hasTicketReported: row.has_ticket_reported,
    ticketAccessible: row.ticket_accessible,
    primary: row.primary_code && row.primary_severity ? { code: row.primary_code as never, severity: row.primary_severity as never } : null,
    findings: row.findings as never,
    // Aditivo (Stage 10) - participantes adicionales (nunca el
    // responsable principal), fuente quality.fieldbeat_report_participants.
    additionalParticipants: row.additional_participants ?? []
  };
}

export interface ReportsListingQueryResult {
  sql: string;
  params: unknown[];
}

/** 1 round-trip: COUNT(*) OVER() (evaluado sobre todo `view_filtered`,
 * antes del LIMIT/OFFSET por semántica estándar de SQL) entrega el total
 * en la misma consulta que trae la página - mismo principio que
 * computeOverviewBundle/computeQualityBundle (Phase 3 §1.1). */
export function buildReportsListingQuery(options: BuildReportsQueryOptions, page: number, pageSize: number): ReportsListingQueryResult {
  const { cteSql, orderBySql, params } = buildReportsFilteredCte(options);
  const offset = (page - 1) * pageSize;
  const sql = `
    WITH ${cteSql}
    SELECT *, COUNT(*) OVER() AS total_count
    FROM view_filtered
    ${orderBySql}
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return { sql, params };
}

/** Sin LIMIT/OFFSET de usuario - tope defensivo fijo (MAX_EXPORT_ROWS,
 * nunca "todo sin límite" - mismo espíritu que MAX_RAW_PAIRS en
 * crossings). El CSV documenta cuántas filas exportó vs. cuántas
 * matchean, nunca trunca en silencio (ver route.ts). */
export function buildReportsExportQuery(options: BuildReportsQueryOptions): ReportsListingQueryResult {
  const { cteSql, orderBySql, params } = buildReportsFilteredCte(options);
  const sql = `
    WITH ${cteSql}
    SELECT *, COUNT(*) OVER() AS total_count
    FROM view_filtered
    ${orderBySql}
    LIMIT ${MAX_EXPORT_ROWS}
  `;
  return { sql, params };
}
