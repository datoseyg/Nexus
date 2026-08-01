// Explorador semántico (Gate B, B20/B21) - consultas curadas por entidad de
// negocio, NUNCA information_schema ni SELECT *. Reutiliza lib/search-sql.ts
// donde ya existe una consulta probada (Reportes/Tickets/Repuestos - mismo
// patrón de identidad de 3 capas ya resuelto por el hotfix FieldBeat, B20:
// "reutilizar, no reinventar"). Entidades sin precedente en Search tienen su
// propia consulta acá, siempre con columnas explícitas.
import { runQuery, serializeRows } from "./db";
import { runGovernanceQuery } from "./governance-db";
import { createParamPusher, type ParamPusher } from "./search-filters";
import {
  buildPartDetailRelatedQuery,
  buildPartDetailSummaryQuery,
  buildTicketDetailRelatedQuery,
  buildTicketDetailSummaryQuery,
  mapPartRow,
  mapReportRow,
  mapTicketRow,
  parsePartsKey
} from "./search-sql";
import type { ExplorerEntity } from "@/types/explorer";

export function clampExplorerPage(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function clampExplorerPageSize(value: number): number {
  const allowed = [25, 50, 100];
  return allowed.includes(value) ? value : 25;
}

export interface SqlQuery {
  sql: string;
  params: unknown[];
}

/** Filtros "boolean" del Explorador viven en la URL como "true"/"false"
 * (nunca un checkbox - "ausente" siempre debe significar "Todos", nunca
 * "No"). Cualquier otro valor se ignora (Todos), nunca lanza. */
export function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

// Un solo placeholder ILIKE reutilizado en todas las columnas (Postgres
// permite referenciar el mismo parámetro posicional más de una vez) - el
// caller decide el conector ("WHERE ..."/"AND (...)") según si la query ya
// trae una cláusula previa. Reemplaza el patrón de reconstruir el mismo
// fragmento ILIKE por separado en cada build*Query/count*Total.
// Paréntesis SIEMPRE alrededor del grupo OR - bug real encontrado en esta
// sección (NEXUS V3, filtros completos): sin ellos, "(a ILIKE $1 OR b ILIKE
// $1) AND otraCondicion" se reescribe silenciosamente por precedencia de
// operadores SQL (AND liga más fuerte que OR) en "a ILIKE $1 OR (b ILIKE $1
// AND otraCondicion)" - una fila que solo matchea la búsqueda de texto por
// la PRIMERA columna se filtraba igual sin importar el resto de los
// filtros. Afectaba a toda entidad que combinara `q=` con cualquier otro
// filtro AND'eado (ya existía para reports.client/taskType antes de esta
// sección, nunca antes ejercitado por una prueba que combinara ambos a la
// vez).
function ilikeConditions(pusher: ParamPusher, filter: string | undefined, columns: string[]): string {
  if (!filter) return "";
  const placeholder = pusher.push(`%${filter}%`);
  return `(${columns.map(col => `${col} ILIKE ${placeholder}`).join(" OR ")})`;
}

// Conteo de "Incidencias activas" por fila del Explorador (columna real
// pedida para Reportes/Repuestos/Clientes/Equipos/Tickets) - SIEMPRE una
// consulta separada vía runGovernanceQuery("app_read", ...), nunca un JOIN
// embebido en la query de runQuery(): governance.issues solo tiene grant
// para los roles de gobierno (nexus_app_read/...), NUNCA para el pool
// genérico de processed/marts/gold (nexus_app) que usa runQuery - mezclar
// ambos en una sola sentencia rompería ese límite de permisos entre roles
// PostgreSQL. Se agrupa por entity_key y se fusiona en memoria con las filas
// ya traídas por runQuery.
// "Activas" = is_currently_detected=true ADEMÁS de status (bug real
// encontrado en revisión visual, 2026-07-30): status por sí solo nunca baja
// cuando una regla deja de detectar una entidad sin una corrección humana
// que dispare verificación (ej. reclasificación NO_PART_USED) - sin este
// filtro, "Incidencias activas" contaba issues que la regla ya no detecta.
export async function fetchActiveIssueCountsByKey(entityType: string | null, entityKeys: string[]): Promise<Map<string, number>> {
  if (entityKeys.length === 0) return new Map();
  const rows = await runGovernanceQuery<{ entity_key: string; n: string }>(
    "app_read",
    `SELECT entity_key, COUNT(*) AS n FROM governance.issues
     WHERE ($1::text IS NULL OR entity_type = $1) AND entity_key = ANY($2) AND is_currently_detected = true AND status IN ('OPEN','IN_REVIEW')
     GROUP BY entity_key`,
    [entityType, entityKeys]
  );
  return new Map(rows.map(row => [row.entity_key, Number(row.n)]));
}

// Repuestos declarados - governance.issues.occurrence_key es used_part_id
// (no fieldbeat_task_id) para rule_code de tipo PART_*, así que el conteo
// por grupo de identidad de repuesto se hace por occurrence_key, no por
// entity_key (que acá es el reporte de origen, no la identidad del repuesto).
export async function fetchActiveIssueCountsByOccurrence(entityType: string, occurrenceKeys: string[]): Promise<Map<string, number>> {
  if (occurrenceKeys.length === 0) return new Map();
  const rows = await runGovernanceQuery<{ occurrence_key: string; n: string }>(
    "app_read",
    `SELECT occurrence_key, COUNT(*) AS n FROM governance.issues
     WHERE entity_type = $1 AND occurrence_key = ANY($2) AND is_currently_detected = true AND status IN ('OPEN','IN_REVIEW')
     GROUP BY occurrence_key`,
    [entityType, occurrenceKeys]
  );
  return new Map(rows.map(row => [row.occurrence_key, Number(row.n)]));
}

// Filtro cross-cutting "con/sin incidencias activas" (clients/equipment/
// reports/tickets/parts) - a diferencia de fetchActiveIssueCountsByKey/
// ByOccurrence (que cuentan issues para un conjunto de filas YA paginadas,
// para mostrar la columna), esto necesita el universo COMPLETO de claves con
// incidencia activa ANTES de paginar (afecta el conteo total, no solo la
// columna). governance.issues solo es legible por roles de gobierno - nunca
// un EXISTS embebido dentro de una sentencia de runQuery() (ver comentario
// de fetchActiveIssueCountsByKey arriba) - se trae la lista completa acá y
// se pasa como `entity_key = ANY($n)`/`NOT (...)` a la query principal.
export async function fetchEntityKeysWithActiveIssues(entityType: string): Promise<string[]> {
  const rows = await runGovernanceQuery<{ entity_key: string }>(
    "app_read",
    `SELECT DISTINCT entity_key FROM governance.issues WHERE entity_type = $1 AND is_currently_detected = true AND status IN ('OPEN','IN_REVIEW')`,
    [entityType]
  );
  return rows.map(row => row.entity_key);
}

export async function fetchOccurrenceKeysWithActiveIssues(entityType: string): Promise<string[]> {
  const rows = await runGovernanceQuery<{ occurrence_key: string }>(
    "app_read",
    `SELECT DISTINCT occurrence_key FROM governance.issues WHERE entity_type = $1 AND is_currently_detected = true AND status IN ('OPEN','IN_REVIEW')`,
    [entityType]
  );
  return rows.map(row => row.occurrence_key);
}

// "Incidencias" por fila (columna real de la tarjeta de resumen/tabla del
// Explorador, sección 12 del encargo) - agrega el conteo real de
// governance.issues sobre las filas ya traídas por runQuery(), consumido
// tanto por el listado paginado como por la exportación CSV (mismas
// columnas, B21). Cada entidad sabe qué columna trae la(s) clave(s) real(es)
// a consultar - nunca inventa una si la query no la trajo.
export async function enrichWithActiveIssueCounts(entity: ExplorerEntity, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (entity === "reports") {
    const keys = rows.map(r => String(r.fieldbeat_task_id));
    const counts = await fetchActiveIssueCountsByKey("report", keys);
    return rows.map(r => ({ ...r, active_issue_count: counts.get(String(r.fieldbeat_task_id)) ?? 0 }));
  }
  if (entity === "clients" || entity === "equipment") {
    const allKeys = Array.from(new Set(rows.flatMap(r => (r.report_task_ids as string[] | null) ?? [])));
    const counts = await fetchActiveIssueCountsByKey(null, allKeys);
    return rows.map(r => {
      const keys = (r.report_task_ids as string[] | null) ?? [];
      const total = keys.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
      const { report_task_ids: _omit, ...rest } = r;
      // report_count venía de un agregado gold.* separado (posiblemente
      // desactualizado frente al conteo en vivo de reportes vinculados a
      // esta fila) - se reemplaza por el conteo real de report_task_ids
      // (la MISMA base usada para active_issue_count) para que ambas
      // columnas describan siempre el mismo universo de reportes, nunca
      // dos bases distintas mostradas una al lado de la otra.
      return { ...rest, report_count: keys.length, active_issue_count: total };
    });
  }
  if (entity === "tickets") {
    const allKeys = Array.from(new Set(rows.flatMap(r => (r.linked_task_ids as string[] | null) ?? [])));
    const counts = await fetchActiveIssueCountsByKey("ticket_link", allKeys);
    return rows.map(r => {
      const keys = (r.linked_task_ids as string[] | null) ?? [];
      const total = keys.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
      const { linked_task_ids: _omit, ...rest } = r;
      return { ...rest, active_issue_count: total };
    });
  }
  if (entity === "parts") {
    const allKeys = Array.from(new Set(rows.flatMap(r => (r.used_part_ids as string[] | null) ?? [])));
    const counts = await fetchActiveIssueCountsByOccurrence("part_occurrence", allKeys);
    return rows.map(r => {
      const keys = (r.used_part_ids as string[] | null) ?? [];
      const total = keys.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
      const { used_part_ids: _omit, ...rest } = r;
      return { ...rest, active_issue_count: total };
    });
  }
  return rows;
}

// =============================================================================
// Reportes - reutiliza marts.fieldbeat_report_dolibarr_operational_view
// (misma fuente que Búsqueda/FieldBeat). Detalle real vive en el drawer
// canónico (FieldbeatReportDetailDrawer / /api/dashboard/fieldbeat/reports/[id])
// - el Explorador NUNCA implementa un segundo detalle de reporte, solo lista.
// =============================================================================
const REPORTS_FILTER_COLUMNS = ["client_name", "CAST(fieldbeat_task_id AS text)"];

// Filtros reales adicionales de Reportes (tarjeta de filtros del Explorador,
// B21 - nunca inventa una columna: cliente/tipo de tarea/periodo ya existen
// en marts.fieldbeat_report_dolibarr_operational_view). client/taskType son
// igualdad exacta (vienen de un <select> con opciones reales, no texto
// libre); dateFrom/dateTo acotan fieldbeat_task_date.
export interface ReportsExplorerFilters {
  client?: string;
  taskType?: string;
  dateFrom?: string;
  dateTo?: string;
  /** internal_id EXACTO (mayúsculas ya normalizadas por el facet) - nunca
   * substring, para no confundir "LINAC-1" con "LINAC-10". */
  equipment?: string;
  /** normalized_name exacto de quality.fieldbeat_report_participants. */
  technician?: string;
  hasTicket?: boolean;
  hasParts?: boolean;
  qualityStatus?: string;
  /** Universo de fieldbeat_task_id con incidencia activa (entity_type=
   * 'report'), ya resuelto vía fetchEntityKeysWithActiveIssues - nunca
   * consultado acá (ver comentario en esa función). */
  activeIssueTaskIds?: string[];
  hasActiveIssues?: boolean;
}

export function parseReportsFilters(searchParams: URLSearchParams): ReportsExplorerFilters {
  return {
    client: searchParams.get("client") ?? undefined,
    taskType: searchParams.get("taskType") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    equipment: searchParams.get("equipment") ?? undefined,
    technician: searchParams.get("technician") ?? undefined,
    hasTicket: parseBooleanParam(searchParams.get("hasTicket")),
    hasParts: parseBooleanParam(searchParams.get("hasParts")),
    qualityStatus: searchParams.get("qualityStatus") ?? undefined,
    hasActiveIssues: parseBooleanParam(searchParams.get("hasActiveIssues"))
  };
}

function reportsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: ReportsExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, REPORTS_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.client) conditions.push(`client_name = ${pusher.push(extra.client)}`);
  if (extra?.taskType) conditions.push(`task_type = ${pusher.push(extra.taskType)}`);
  if (extra?.dateFrom) conditions.push(`fieldbeat_task_date >= ${pusher.push(extra.dateFrom)}::date`);
  if (extra?.dateTo) conditions.push(`fieldbeat_task_date <= ${pusher.push(extra.dateTo)}::date`);
  if (extra?.equipment) {
    const placeholder = pusher.push(extra.equipment.toUpperCase().trim());
    conditions.push(`EXISTS (SELECT 1 FROM UNNEST(STRING_TO_ARRAY(r.equipment_internal_ids, '|')) eq WHERE UPPER(TRIM(eq)) = ${placeholder})`);
  }
  if (extra?.technician) {
    const placeholder = pusher.push(extra.technician);
    conditions.push(`EXISTS (SELECT 1 FROM quality.fieldbeat_report_participants p WHERE p.fieldbeat_task_id = r.fieldbeat_task_id AND p.normalized_name = ${placeholder})`);
  }
  if (extra?.hasTicket === true) conditions.push(`NULLIF(TRIM(r.linked_zendesk_ticket_id), '') IS NOT NULL`);
  if (extra?.hasTicket === false) conditions.push(`NULLIF(TRIM(r.linked_zendesk_ticket_id), '') IS NULL`);
  if (extra?.hasParts === true) conditions.push(`r.used_parts_count > 0`);
  if (extra?.hasParts === false) conditions.push(`r.used_parts_count = 0`);
  if (extra?.qualityStatus) conditions.push(`r.report_quality_status = ${pusher.push(extra.qualityStatus)}`);
  if (extra?.hasActiveIssues === true) conditions.push(`r.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])})`);
  if (extra?.hasActiveIssues === false) conditions.push(`NOT (r.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  return conditions;
}

export function buildReportsListQuery(
  pusher: ParamPusher,
  limit: number,
  offset: number,
  filter?: string,
  extra?: ReportsExplorerFilters
): SqlQuery {
  const conditions = reportsFilterConditions(pusher, filter, extra);
  const sql = `
    SELECT r.fieldbeat_task_id, r.fieldbeat_task_date, r.client_name, r.task_type,
           r.equipment_internal_ids, r.linked_zendesk_ticket_id, r.used_parts_count, r.report_quality_status
    FROM marts.fieldbeat_report_dolibarr_operational_view r
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY r.fieldbeat_task_date DESC, r.fieldbeat_task_id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

// Opciones reales para el <select> "Tipo de tarea" de la tarjeta de filtros
// (sección 6) - nunca un enum adivinado a mano.
export async function fetchReportTaskTypes(): Promise<string[]> {
  const rows = await runQuery<{ task_type: string }>(
    `SELECT DISTINCT task_type FROM marts.fieldbeat_report_dolibarr_operational_view WHERE task_type IS NOT NULL ORDER BY task_type`
  );
  return rows.map(r => r.task_type);
}

export async function fetchReportEquipmentInternalIdOptions(): Promise<string[]> {
  const rows = await runQuery<{ eq: string }>(
    `SELECT DISTINCT UPPER(TRIM(eq)) AS eq
     FROM marts.fieldbeat_report_dolibarr_operational_view r, LATERAL UNNEST(STRING_TO_ARRAY(r.equipment_internal_ids, '|')) eq
     WHERE TRIM(eq) <> '' ORDER BY 1`
  );
  return rows.map(r => r.eq);
}

export async function fetchReportTechnicianOptions(): Promise<string[]> {
  const rows = await runQuery<{ normalized_name: string }>(
    `SELECT DISTINCT normalized_name FROM quality.fieldbeat_report_participants WHERE normalized_name IS NOT NULL ORDER BY normalized_name`
  );
  return rows.map(r => r.normalized_name);
}

export async function countReportsTotal(filter?: string, extra?: ReportsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const conditions = reportsFilterConditions(pusher, filter, extra);
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view r ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

// =============================================================================
// Tickets - reutiliza processed.zendesk_tickets + el detalle ya probado de
// Búsqueda (buildTicketDetailSummaryQuery/buildTicketDetailRelatedQuery).
// =============================================================================
const TICKETS_FILTER_COLUMNS = ["COALESCE(z.subject, z.raw_subject)", "CAST(z.zendesk_ticket_id AS text)"];

export interface TicketsExplorerFilters {
  ticketStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  hasReports?: boolean;
  /** Universo de fieldbeat_task_id con incidencia activa (entity_type=
   * 'ticket_link') - ver comentario en fetchEntityKeysWithActiveIssues. */
  activeIssueTaskIds?: string[];
  hasActiveIssues?: boolean;
}

export function parseTicketsFilters(searchParams: URLSearchParams): TicketsExplorerFilters {
  return {
    ticketStatus: searchParams.get("ticketStatus") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    hasReports: parseBooleanParam(searchParams.get("hasReports")),
    hasActiveIssues: parseBooleanParam(searchParams.get("hasActiveIssues"))
  };
}

function ticketsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: TicketsExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, TICKETS_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.ticketStatus) conditions.push(`z.status = ${pusher.push(extra.ticketStatus)}`);
  if (extra?.dateFrom) conditions.push(`z.created_at >= ${pusher.push(extra.dateFrom)}::date`);
  if (extra?.dateTo) conditions.push(`z.created_at < (${pusher.push(extra.dateTo)}::date + 1)`);
  const linkedReportExists = `EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text)`;
  if (extra?.hasReports === true) conditions.push(linkedReportExists);
  if (extra?.hasReports === false) conditions.push(`NOT ${linkedReportExists}`);
  // pusher.push() SOLO dentro de la rama que realmente usa el placeholder -
  // nunca hoisteado a un const computado incondicionalmente (bug real: eso
  // empuja un parámetro "fantasma" a pusher.params en TODA llamada, incluso
  // cuando ninguna rama de abajo termina referenciándolo en el SQL final,
  // rompiendo el conteo de bind params de Postgres - "supplies N, requires
  // N-1" en cualquier request que no use este filtro).
  if (extra?.hasActiveIssues === true) {
    conditions.push(`EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r
      WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text AND r.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  }
  if (extra?.hasActiveIssues === false) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r
      WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text AND r.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  }
  return conditions;
}

export function buildTicketsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: TicketsExplorerFilters): SqlQuery {
  const conditions = ticketsFilterConditions(pusher, filter, extra);
  const sql = `
    SELECT z.zendesk_ticket_id, z.status, COALESCE(z.subject, z.raw_subject) AS title, z.created_at,
      (SELECT COUNT(DISTINCT r.fieldbeat_task_id) FROM marts.fieldbeat_report_dolibarr_operational_view r
        WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text) AS linked_report_count,
      (SELECT ARRAY_AGG(r.fieldbeat_task_id::text) FROM marts.fieldbeat_report_dolibarr_operational_view r
        WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text) AS linked_task_ids
    FROM processed.zendesk_tickets z
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY z.created_at DESC, z.zendesk_ticket_id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function fetchTicketStatusOptions(): Promise<string[]> {
  const rows = await runQuery<{ status: string }>(`SELECT DISTINCT status FROM processed.zendesk_tickets WHERE status IS NOT NULL ORDER BY status`);
  return rows.map(r => r.status);
}

export async function countTicketsTotal(filter?: string, extra?: TicketsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const conditions = ticketsFilterConditions(pusher, filter, extra);
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM processed.zendesk_tickets z ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function fetchTicketDetail(zendeskTicketId: string) {
  const summaryQuery = buildTicketDetailSummaryQuery(zendeskTicketId);
  const summaryRows = await runQuery<Record<string, unknown>>(summaryQuery.sql, summaryQuery.params);
  if (summaryRows.length === 0) return null;
  const relatedQuery = buildTicketDetailRelatedQuery(zendeskTicketId);
  const relatedRows = await runQuery<{ linked_reports: unknown[] }>(relatedQuery.sql, relatedQuery.params);
  return {
    summary: mapTicketRow(serializeRows(summaryRows)[0]),
    related: { linkedReports: (relatedRows[0]?.linked_reports ?? []).map(r => mapReportRow(r as Record<string, unknown>)) }
  };
}

// =============================================================================
// Repuestos declarados - reutiliza el modelo de 3 identidades ya resuelto por
// el hotfix FieldBeat (catalog-product:/raw-part:/raw-occurrence:), mismas
// funciones que Búsqueda (parsePartsKey, buildPartDetail*Query, mapPartRow) -
// nunca reimplementado en paralelo.
// =============================================================================
// Misma expresión de identidad que partsGroupKeySql (search-sql.ts), no
// exportada ahí - se repite acá solo el fragmento SQL (no la lógica de
// negocio, que sigue viviendo únicamente en parsePartsKey/mapPartRow/
// buildPartDetail*Query, reutilizados sin cambios).
const PARTS_IDENTITY_EXPR = `
  CASE
    WHEN NULLIF(TRIM(m.dolibarr_ref), '') IS NOT NULL THEN 'catalog-product:' || TRIM(m.dolibarr_ref)
    WHEN m.normalized_part_identifier IS NOT NULL OR m.raw_part_identifier IS NOT NULL
      THEN 'raw-part:' || COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier)))
    ELSE 'raw-occurrence:' || m.used_part_id
  END
`;

const PARTS_FILTER_COLUMNS = ["m.dolibarr_ref", "m.dolibarr_label", "m.part_name", "m.raw_part_identifier"];

// Filtros reales de Repuestos declarados. match_status usa el vocabulario de
// 5 valores real de marts.used_parts_dolibarr_match (MATCHED/NO_MATCH/
// AMBIGUOUS_MATCH/PLACEHOLDER_VALUE/NO_PART_USED - ver
// quality.classify_part_declaration, sql/098/099). Deliberadamente
// NO existen filtros "part_usage_status"/"requires_review": ninguna de las
// dos es una columna real de repuestos en este codebase (requires_review
// solo existe en config.contract_equipment_versions, dominio de contratos) -
// agregarlas violaría "no inventes filtros ni enums".
export interface PartsExplorerFilters {
  matchStatus?: string;
  hasDolibarrProduct?: boolean;
  client?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Universo de used_part_id (occurrence_key, entity_type='part_occurrence')
   * con incidencia activa - ver fetchOccurrenceKeysWithActiveIssues. */
  activeIssueUsedPartIds?: string[];
  hasActiveIssues?: boolean;
}

export function parsePartsFilters(searchParams: URLSearchParams): PartsExplorerFilters {
  return {
    matchStatus: searchParams.get("matchStatus") ?? undefined,
    hasDolibarrProduct: parseBooleanParam(searchParams.get("hasDolibarrProduct")),
    client: searchParams.get("client") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    hasActiveIssues: parseBooleanParam(searchParams.get("hasActiveIssues"))
  };
}

// A diferencia de las demás entidades, Repuestos AGRUPA varias filas físicas
// (varias used_part_id) por identidad - un filtro que depende del agregado
// (con/sin incidencias activas: ¿ALGUNA ocurrencia de este grupo tiene
// incidencia activa?) debe ir en HAVING sobre bool_or(), nunca en WHERE
// pre-agregación (un WHERE ahí filtraría FILAS FÍSICAS antes de agrupar,
// rompiendo silenciosamente el caso "sin incidencias activas" - un grupo con
// una ocurrencia activa y otra no activa perdería la fila no-activa del
// cálculo y podría no distinguirse correctamente del caso "ninguna activa").
function partsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: PartsExplorerFilters | undefined): { where: string[]; having: string[] } {
  const where: string[] = [];
  const having: string[] = [];
  const cond = ilikeConditions(pusher, filter, PARTS_FILTER_COLUMNS);
  if (cond) where.push(cond);
  if (extra?.matchStatus) where.push(`m.match_status = ${pusher.push(extra.matchStatus)}`);
  if (extra?.hasDolibarrProduct === true) where.push(`NULLIF(TRIM(m.dolibarr_ref), '') IS NOT NULL`);
  if (extra?.hasDolibarrProduct === false) where.push(`NULLIF(TRIM(m.dolibarr_ref), '') IS NULL`);
  if (extra?.client) where.push(`r.client_name = ${pusher.push(extra.client)}`);
  if (extra?.dateFrom) where.push(`r.fieldbeat_task_date >= ${pusher.push(extra.dateFrom)}::date`);
  if (extra?.dateTo) where.push(`r.fieldbeat_task_date <= ${pusher.push(extra.dateTo)}::date`);
  if (extra?.hasActiveIssues === true) having.push(`bool_or(m.used_part_id::text = ANY(${pusher.push(extra.activeIssueUsedPartIds ?? [])}))`);
  if (extra?.hasActiveIssues === false) having.push(`NOT bool_or(m.used_part_id::text = ANY(${pusher.push(extra.activeIssueUsedPartIds ?? [])}))`);
  return { where, having };
}

export function buildPartsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: PartsExplorerFilters): SqlQuery {
  const { where, having } = partsFilterConditions(pusher, filter, extra);
  const sql = `
    SELECT
      ${PARTS_IDENTITY_EXPR} AS part_key,
      MAX(m.dolibarr_ref) AS dolibarr_ref,
      COALESCE(MAX(m.dolibarr_label), MAX(m.part_name)) AS part_name,
      MAX(m.raw_part_identifier) AS raw_part_identifier,
      MAX(COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier)))) AS normalized_identifier,
      MAX(m.used_part_id) AS used_part_id,
      ARRAY_AGG(DISTINCT m.used_part_id::text) AS used_part_ids,
      MAX(m.match_status) AS match_status,
      SUM(COALESCE(p.quantity, 1)) AS quantity_consumed,
      COUNT(DISTINCT m.fieldbeat_task_id) AS report_count,
      COUNT(DISTINCT r.client_name) AS client_count
    FROM marts.used_parts_dolibarr_match m
    LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
    LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY ${PARTS_IDENTITY_EXPR}
    ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
    ORDER BY quantity_consumed DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countPartsTotal(filter?: string, extra?: PartsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const { where, having } = partsFilterConditions(pusher, filter, extra);
  const sql = `
    SELECT COUNT(*) AS n FROM (
      SELECT ${PARTS_IDENTITY_EXPR} AS part_key
      FROM marts.used_parts_dolibarr_match m
      LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY ${PARTS_IDENTITY_EXPR}
      ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
    ) grouped
  `;
  const rows = await runQuery<{ n: string }>(sql, pusher.params);
  return Number(rows[0]?.n ?? 0);
}

export async function fetchPartDetail(key: string) {
  const partsKey = parsePartsKey(key);
  const summaryQuery = buildPartDetailSummaryQuery(partsKey);
  const summaryRows = await runQuery<Record<string, unknown>>(summaryQuery.sql, summaryQuery.params);
  if (summaryRows.length === 0 || summaryRows[0].used_part_id == null) return null;
  const relatedQuery = buildPartDetailRelatedQuery(partsKey);
  const relatedRows = await runQuery<{ recent_usages: unknown[] }>(relatedQuery.sql, relatedQuery.params);
  return {
    summary: mapPartRow(serializeRows(summaryRows)[0]),
    related: { recentUsages: relatedRows[0]?.recent_usages ?? [] }
  };
}

// =============================================================================
// Incidencias - vista de solo lectura del backlog de Auditoría
// (governance.issues, B1). Enlaza al flujo de Auditoría para actuar - nunca
// una acción desde acá. governance.issues/issue_evidence_business_safe solo
// tienen grant para los roles de gobierno (nexus_app_read/...), NUNCA para
// el pool genérico de lectura (nexus_app en producción) - por eso estas dos
// funciones usan runGovernanceQuery("app_read", ...), no runQuery().
// =============================================================================
// Mismo mapeo que VERIFICATION_FILTER_SQL en lib/audit-governance-sql.ts
// (Bandeja de Auditoría) - reutiliza el mismo criterio de negocio en vez de
// inventar uno nuevo acá; se repite el literal (5 líneas, vocabulario
// cerrado y estable) en vez de acoplar explorer-sql.ts al módulo de
// Auditoría para un lookup tan pequeño.
const ISSUES_VERIFICATION_FILTER_SQL: Record<string, string> = {
  pending: "lv.processing_status IN ('PENDING','RUNNING')",
  still_detected: "lv.verification_outcome = 'STILL_DETECTED'",
  passed: "lv.verification_outcome = 'PASSED'",
  dead_letter: "lv.processing_status = 'DEAD_LETTERED'",
  none: "lv.processing_status IS NULL"
};

export interface IssuesExplorerFilters {
  severity?: string;
  status?: string;
  entityType?: string;
  // Mismo criterio que BandejaFilters.detection (lib/audit-governance-sql.ts)
  // - default = solo lo actualmente detectado, "all" para incluir lo
  // histórico/desaparecido. Bug real: sin esto, "Incidencias" en Explorador
  // mostraba issues que la regla ya no detecta como si fueran vigentes.
  detection?: "current" | "all";
  ruleCode?: string;
  dateFrom?: string;
  dateTo?: string;
  verification?: "pending" | "still_detected" | "passed" | "dead_letter" | "none";
}

export function parseIssuesFilters(searchParams: URLSearchParams): IssuesExplorerFilters {
  const detection = searchParams.get("detection");
  const verification = searchParams.get("verification");
  return {
    severity: searchParams.get("severity") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    entityType: searchParams.get("entityType") ?? undefined,
    detection: detection === "all" ? "all" : "current",
    ruleCode: searchParams.get("ruleCode") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    verification:
      verification && verification in ISSUES_VERIFICATION_FILTER_SQL ? (verification as IssuesExplorerFilters["verification"]) : undefined
  };
}

export async function fetchIssuesList(
  limit: number,
  offset: number,
  filter?: string,
  extra?: IssuesExplorerFilters
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (extra?.detection !== "all") {
    conditions.push(`i.is_currently_detected = true`);
  }
  if (filter) {
    params.push(`%${filter}%`);
    conditions.push(`(i.entity_key ILIKE $${params.length} OR rd.title ILIKE $${params.length})`);
  }
  if (extra?.severity) {
    params.push(extra.severity);
    conditions.push(`i.severity = $${params.length}`);
  }
  if (extra?.status) {
    params.push(extra.status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (extra?.entityType) {
    params.push(extra.entityType);
    conditions.push(`i.entity_type = $${params.length}`);
  }
  if (extra?.ruleCode) {
    params.push(extra.ruleCode);
    conditions.push(`i.rule_code = $${params.length}`);
  }
  if (extra?.dateFrom) {
    params.push(extra.dateFrom);
    conditions.push(`i.first_seen_at >= $${params.length}::date`);
  }
  if (extra?.dateTo) {
    params.push(extra.dateTo);
    conditions.push(`i.first_seen_at < ($${params.length}::date + 1)`);
  }
  if (extra?.verification) {
    conditions.push(ISSUES_VERIFICATION_FILTER_SQL[extra.verification]);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows, countRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT i.id, i.rule_code, coalesce(rd.title, i.rule_code) AS rule_title, i.severity, i.status,
              i.entity_type, i.entity_key, i.occurrence_key, i.first_seen_at, i.last_seen_at, i.is_currently_detected,
              lv.processing_status AS verification_processing_status, lv.verification_outcome AS verification_outcome
       FROM governance.issues i
       LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
       LEFT JOIN LATERAL (
         SELECT vr.processing_status, vr.verification_outcome
         FROM governance.verification_requests_current vr
         WHERE vr.issue_id = i.id
         ORDER BY vr.created_at DESC, vr.id DESC
         LIMIT 1
       ) lv ON true
       ${where}
       ORDER BY i.last_seen_at DESC, i.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    runGovernanceQuery<{ n: string }>(
      "app_read",
      `SELECT COUNT(*) AS n FROM governance.issues i
       LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
       LEFT JOIN LATERAL (
         SELECT vr.processing_status, vr.verification_outcome
         FROM governance.verification_requests_current vr
         WHERE vr.issue_id = i.id
         ORDER BY vr.created_at DESC, vr.id DESC
         LIMIT 1
       ) lv ON true
       ${where}`,
      params
    )
  ]);
  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
}

export async function fetchIssueRuleCodeOptions(): Promise<Array<{ value: string; label: string }>> {
  const rows = await runGovernanceQuery<{ rule_code: string; title: string }>(
    "app_read",
    `SELECT DISTINCT i.rule_code, coalesce(rd.title, i.rule_code) AS title
     FROM governance.issues i
     LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
     ORDER BY 2`
  );
  return rows.map(r => ({ value: r.rule_code, label: r.title }));
}

export async function fetchIssueDetail(id: string) {
  if (!/^\d+$/.test(id)) return null;
  const summaryRows = await runGovernanceQuery<Record<string, unknown>>(
    "app_read",
    `SELECT i.id, i.rule_code, coalesce(rd.title, i.rule_code) AS rule_title, i.severity, i.status,
            i.entity_type, i.entity_key, i.occurrence_key, i.first_seen_at, i.last_seen_at, i.last_evaluated_at,
            i.is_currently_detected, i.disappeared_at, i.resolution_type, i.closed_at, i.version
     FROM governance.issues i
     LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
     WHERE i.id = $1`,
    [id]
  );
  if (summaryRows.length === 0) return null;
  const evidenceRows = await runGovernanceQuery<Record<string, unknown>>(
    "app_read",
    `SELECT id, evidence_type, rule_code, rule_version, source_object, rule_inputs, observed_values, effective_values, captured_at
     FROM governance.issue_evidence_business_safe WHERE issue_id = $1 ORDER BY id DESC LIMIT 10`,
    [id]
  );
  return {
    summary: serializeRows(summaryRows)[0],
    related: { evidence: serializeRows(evidenceRows) }
  };
}

// =============================================================================
// Clientes - processed.fieldbeat_clients es la fuente estructurada real (B20)
// - nunca los agregados derivados de reportes que ya usa Búsqueda (esos
// responden "¿en qué reportes aparece este nombre?", no "¿qué clientes
// existen realmente?"). Sin PK real en la base (documentación, no
// constraint) - client_key es la clave de negocio. rut/latitude/longitude
// EXCLUIDOS siempre (B21: RUT es identificador tributario, lat/long es
// geolocalización precisa - ninguno aporta valor de exploración de negocio
// que justifique el riesgo). address_raw solo en detalle (dirección
// institucional, no de persona física, pero sin valor en un listado).
// gold.client_service_profile se une por client_name (no client_key. - único
// campo común confiable entre ambas tablas, documentado como "mismo valor en
// la práctica" pero sin garantía de unicidad exacta) - un cliente sin match
// simplemente muestra conteos en 0, nunca un error.
// =============================================================================
// Identidad de negocio de Cliente (corrección de duplicados, ver hallazgo
// real confirmado por lectura directa de processed.fieldbeat_clients): la
// tabla fuente tiene MÚLTIPLES filas físicas (client_key distinto) para el
// mismo cliente real - típicamente una con `rut` capturado y otra con
// `rut` NULL, a veces con la misma dirección repetida, a veces con
// dirección NULL en la fila incompleta. `rut` NUNCA es la clave canónica:
// se confirmó un caso real donde dos clientes de nombre distinto (ACME y
// HOSPITAL CARLOS VAN BUREN (SSVSA)) comparten el mismo valor de `rut` en
// esta base, y otro caso (EYG MEDICAL SYSTEMS LTDA.) donde el mismo RUT real
// aparece formateado de 2 formas distintas ("76.089.058-8"/"76089058-8") -
// agrupar por rut normalizado habría fusionado clientes distintos en el
// primer caso y seguido separando el mismo cliente en el segundo. La clave
// canónica real y estable en esta fuente es el nombre normalizado
// (UPPER(TRIM(client_name))) - confirmado exhaustivamente: agrupando por
// este valor, las 43 filas físicas colapsan a exactamente 26 clientes
// reales (26 = COUNT(DISTINCT client_name) ya observado), sin fusionar
// ningún par de nombres genuinamente distintos (ej. "UC CHRISTUS - CECA" y
// "UC CHRISTUS - SCA" siguen siendo 2 filas, comparten rut pero tienen
// nombre distinto - se conservan separadas a propósito).
//
// Ubicaciones reales (no filas físicas): `location_count` cuenta
// direcciones DISTINTAS no nulas (GREATEST(...,1) porque un cliente sin
// ninguna dirección capturada sigue siendo 1 ubicación, no 0) - una fila
// duplicada con la MISMA dirección (el caso más común) o con dirección NULL
// (fila incompleta) nunca cuenta como una sede adicional; solo direcciones
// realmente distintas (ej. ACME Santiago vs ACME Rancagua) lo hacen.
const CLIENTS_CANONICAL_CTE = `
  WITH canonical_clients AS (
    SELECT
      UPPER(TRIM(c.client_name)) AS canonical_client_key,
      (ARRAY_AGG(c.client_name ORDER BY (c.address_raw IS NULL), c.client_key))[1] AS client_name,
      (ARRAY_AGG(c.city ORDER BY (c.address_raw IS NULL), c.client_key))[1] AS city,
      (ARRAY_AGG(c.commune ORDER BY (c.address_raw IS NULL), c.client_key))[1] AS commune,
      (ARRAY_AGG(c.country ORDER BY (c.address_raw IS NULL), c.client_key))[1] AS country,
      (ARRAY_AGG(c.address_raw ORDER BY (c.address_raw IS NULL), c.client_key))[1] AS address_raw,
      GREATEST(COUNT(DISTINCT c.address_raw) FILTER (WHERE c.address_raw IS NOT NULL), 1) AS location_count
    FROM processed.fieldbeat_clients c
    GROUP BY UPPER(TRIM(c.client_name))
  )
`;
const CLIENTS_FILTER_COLUMNS = ["canonical_clients.client_name", "canonical_clients.city"];

// "estado contractual" a nivel Cliente NO se implementa a propósito - no
// existe una columna real a ese nivel (requeriría un rollup vía equipo/
// contrato, fuera de alcance de un filtro simple); documentado como brecha
// en el reporte final, no fabricado acá.
export interface ClientsExplorerFilters {
  city?: string;
  commune?: string;
  hasEquipment?: boolean;
  hasReports?: boolean;
  /** Universo de fieldbeat_task_id con incidencia activa (entity_type=
   * 'report') - ver fetchEntityKeysWithActiveIssues. */
  activeIssueTaskIds?: string[];
  hasActiveIssues?: boolean;
}

export function parseClientsFilters(searchParams: URLSearchParams): ClientsExplorerFilters {
  return {
    city: searchParams.get("city") ?? undefined,
    commune: searchParams.get("commune") ?? undefined,
    hasEquipment: parseBooleanParam(searchParams.get("hasEquipment")),
    hasReports: parseBooleanParam(searchParams.get("hasReports")),
    hasActiveIssues: parseBooleanParam(searchParams.get("hasActiveIssues"))
  };
}

function clientsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: ClientsExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, CLIENTS_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.city) conditions.push(`canonical_clients.city = ${pusher.push(extra.city)}`);
  if (extra?.commune) conditions.push(`canonical_clients.commune = ${pusher.push(extra.commune)}`);
  const hasEquipmentExists = `EXISTS (SELECT 1 FROM processed.fieldbeat_equipments e
    LEFT JOIN processed.fieldbeat_clients c2 ON c2.client_key = e.client_key
    WHERE UPPER(TRIM(c2.client_name)) = canonical_clients.canonical_client_key)`;
  if (extra?.hasEquipment === true) conditions.push(hasEquipmentExists);
  if (extra?.hasEquipment === false) conditions.push(`NOT ${hasEquipmentExists}`);
  const hasReportsExists = `EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r
    WHERE UPPER(TRIM(r.client_name)) = canonical_clients.canonical_client_key)`;
  if (extra?.hasReports === true) conditions.push(hasReportsExists);
  if (extra?.hasReports === false) conditions.push(`NOT ${hasReportsExists}`);
  // pusher.push() SOLO dentro de la rama que lo usa - ver comentario
  // equivalente en ticketsFilterConditions (mismo bug real corregido en las
  // 3 entidades que lo tenían: tickets/clients/equipment).
  if (extra?.hasActiveIssues === true) {
    conditions.push(`EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r
      WHERE UPPER(TRIM(r.client_name)) = canonical_clients.canonical_client_key AND r.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  }
  if (extra?.hasActiveIssues === false) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r
      WHERE UPPER(TRIM(r.client_name)) = canonical_clients.canonical_client_key AND r.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  }
  return conditions;
}

export function buildClientsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: ClientsExplorerFilters): SqlQuery {
  const conditions = clientsFilterConditions(pusher, filter, extra);
  const sql = `
    ${CLIENTS_CANONICAL_CTE}
    SELECT
      canonical_clients.canonical_client_key AS client_key,
      canonical_clients.client_name, canonical_clients.city, canonical_clients.commune, canonical_clients.country,
      canonical_clients.location_count,
      COALESCE(g.fieldbeat_report_count, 0) AS report_count,
      COALESCE(g.total_tickets, 0) AS ticket_count,
      (SELECT ARRAY_AGG(r.fieldbeat_task_id::text) FROM marts.fieldbeat_report_dolibarr_operational_view r
        WHERE UPPER(TRIM(r.client_name)) = canonical_clients.canonical_client_key) AS report_task_ids
    FROM canonical_clients
    LEFT JOIN gold.client_service_profile g ON UPPER(TRIM(g.client_name)) = canonical_clients.canonical_client_key
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY report_count DESC, canonical_clients.client_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

// Independiente de /api/dashboard/operacional/filters (endpoint compartido
// no relacionado, que el Explorador usaba antes por atajo) - misma
// identidad canónica que CLIENTS_CANONICAL_CTE, consulta propia y acotada.
export async function fetchClientNameOptions(): Promise<string[]> {
  const rows = await runQuery<{ client_name: string }>(`${CLIENTS_CANONICAL_CTE} SELECT client_name FROM canonical_clients ORDER BY client_name`);
  return rows.map(r => r.client_name);
}

export async function fetchClientCityOptions(): Promise<string[]> {
  const rows = await runQuery<{ city: string }>(`SELECT DISTINCT city FROM processed.fieldbeat_clients WHERE city IS NOT NULL AND TRIM(city) <> '' ORDER BY city`);
  return rows.map(r => r.city);
}

export async function fetchClientCommuneOptions(): Promise<string[]> {
  const rows = await runQuery<{ commune: string }>(`SELECT DISTINCT commune FROM processed.fieldbeat_clients WHERE commune IS NOT NULL AND TRIM(commune) <> '' ORDER BY commune`);
  return rows.map(r => r.commune);
}

export async function countClientsTotal(filter?: string, extra?: ClientsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const conditions = clientsFilterConditions(pusher, filter, extra);
  const rows = await runQuery<{ n: string }>(
    `${CLIENTS_CANONICAL_CTE} SELECT COUNT(*) AS n FROM canonical_clients ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

// Identidad canónica de Equipo (duplicación real confirmada leyendo
// directamente processed.fieldbeat_equipments - 85 filas físicas para
// exactamente 58 equipos reales). Dos causas distintas, ambas confirmadas
// con datos reales, ninguna resoluble agrupando solo por el identificador
// visible (internal_id):
//  1. equipment_key = FIELDBEAT_EQUIPMENT|<uuid>|<internal_id> depende de
//     equipment_uuid (el "id" que FieldBeat adjunta al equipo DENTRO de cada
//     reporte) - ese uuid es inestable entre ocurrencias del MISMO equipo
//     físico: a veces ausente (cadena vacía), a veces un uuid real, a veces
//     literalmente el propio internal_id repetido como "id" (dato de origen,
//     no de esta app). Confirmado: "Linac-152171" tiene equipment_key
//     ".../0f2acfc5-.../Linac-152171" en casi todas sus ocurrencias, pero
//     ".../<vacío>/Linac-152171" en al menos una - dos filas físicas para un
//     solo equipo real, sin relación con mayúsculas/minúsculas.
//  2. internal_id tiene variantes de mayúsculas/minúsculas para el MISMO
//     equipo (confirmado: "LINAC-153038" vs "Linac-153038").
// Además, e.client_key hereda la MISMA fragmentación ya corregida para
// Clientes (fila con rut / fila sin rut, ver CLIENTS_CANONICAL_CTE) -
// agrupar solo por (client_key crudo, internal_id normalizado) NO alcanza
// (quedan 72 grupos, no 58). La identidad real y estable reutiliza
// canonical_clients (arriba) en vez de reinventar la canonicalización de
// cliente acá: (nombre de cliente CANÓNICO, internal_id normalizado) -
// confirmado exhaustivamente que agrupando así, las 85 filas físicas
// colapsan a exactamente 58 equipos reales (mismo número que arroja
// COUNT(DISTINCT UPPER(TRIM(internal_id))) sobre el export previo, sin
// depender de client_key) - sin fusionar equipos de clientes distintos,
// porque el nombre de cliente sigue formando parte de la clave.
// source_equipment_keys (todas las filas físicas que colapsaron acá) es lo
// que permite luego unir contra config.contract_equipment_analysis.
// fieldbeat_equipment_key sin importar CUÁL de las filas físicas haya sido
// la que el matcher de contratos efectivamente enlazó.
const EQUIPMENT_CANONICAL_CTE = `${CLIENTS_CANONICAL_CTE},
  canonical_equipment AS (
    SELECT
      COALESCE(cc.canonical_client_key, e.client_key) AS client_key,
      COALESCE(cc.client_name, e.client_key) AS client_name,
      UPPER(TRIM(e.internal_id)) AS internal_id,
      COALESCE(cc.canonical_client_key, e.client_key) || '::' || UPPER(TRIM(e.internal_id)) AS equipment_key,
      (ARRAY_AGG(e.equipment_type) FILTER (WHERE e.equipment_type IS NOT NULL))[1] AS equipment_type,
      ARRAY_AGG(DISTINCT e.equipment_key) AS source_equipment_keys
    FROM processed.fieldbeat_equipments e
    LEFT JOIN processed.fieldbeat_clients c ON c.client_key = e.client_key
    LEFT JOIN canonical_clients cc ON cc.canonical_client_key = UPPER(TRIM(c.client_name))
    GROUP BY 1, 2, 3
  )
`;

// Candidatos de contrato para un equipo canónico - agrega TODOS los
// contratos vigentes (is_current) cuyo fieldbeat_equipment_key coincida con
// CUALQUIERA de las filas físicas que colapsaron en este equipo (nunca solo
// la primera/última). En los datos reales de hoy nunca hay más de 1 modelo
// distinto por equipo canónico (verificado), pero la agregación nunca elige
// uno arbitrariamente vía MAX/MIN/primera fila: si alguna vez hubiera 2+
// contratos en desacuerdo, ambos valores viajan juntos (join " / " en el
// formateador de columna, ver explorer-entity-config.ts) en vez de que uno
// oculte al otro.
const EQUIPMENT_CONTRACT_CANDIDATES_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT ca.equipment_model) AS equipment_models,
      ARRAY_AGG(DISTINCT ca.serial_number) FILTER (WHERE ca.serial_number IS NOT NULL) AS serial_numbers,
      ARRAY_AGG(DISTINCT ca.contract_status_code) AS contract_status_codes,
      ARRAY_AGG(DISTINCT ca.warranty_end_date) FILTER (WHERE ca.warranty_end_date IS NOT NULL) AS warranty_end_dates,
      ARRAY_AGG(DISTINCT ca.match_status) AS match_statuses,
      ARRAY_AGG(DISTINCT ca.equipment_key) AS contract_keys,
      COUNT(DISTINCT ca.equipment_key) AS contract_count,
      -- Mantenimiento preventivo (Q Mant Prev x Año) - ver preventiveMaintenanceLabel
      -- en lib/contracts-vocabulary.ts: la ÚNICA cifra contractual real con
      -- unidad/periodo propios en la fuente (no existe un campo de "horas
      -- contractuales"). Min/max/rule viajan juntos por fila (nunca mezclados
      -- entre equipos distintos) para que el cliente pueda listarlos sin sumar
      -- unidades incompatibles.
      ARRAY_AGG(DISTINCT ca.preventive_maintenance_min) AS preventive_maintenance_mins,
      ARRAY_AGG(DISTINCT ca.preventive_maintenance_max) AS preventive_maintenance_maxs,
      ARRAY_AGG(DISTINCT ca.preventive_maintenance_rule) FILTER (WHERE ca.preventive_maintenance_rule IS NOT NULL) AS preventive_maintenance_rules
    FROM config.contract_equipment_analysis ca
    WHERE ca.is_current = true AND ca.fieldbeat_equipment_key = ANY(canonical_equipment.source_equipment_keys)
  ) contract ON true
`;

// Resolución de modelo (nunca MAX/MIN/primera fila): RESOLVED cuando los
// contratos vigentes vinculados concuerdan en exactamente 1 modelo (el caso
// real de hoy, siempre - verificado, 0 conflictos en los datos actuales),
// AMBIGUOUS cuando hay 2+ modelos distintos (model queda NULL a propósito -
// la UI muestra "Modelo por confirmar" en vez de elegir uno), UNKNOWN cuando
// no hay ningún contrato vigente vinculado. equipment_models (el arreglo
// completo) sigue disponible aparte para mostrar los candidatos + procedencia
// en el detalle, nunca se pierde aunque el campo `model` quede en NULL.
const EQUIPMENT_MODEL_RESOLUTION_COLUMNS = `
  CASE WHEN COALESCE(array_length(contract.equipment_models, 1), 0) = 1 THEN contract.equipment_models[1] ELSE NULL END AS model,
  CASE
    WHEN COALESCE(array_length(contract.equipment_models, 1), 0) = 0 THEN 'UNKNOWN'
    WHEN array_length(contract.equipment_models, 1) = 1 THEN 'RESOLVED'
    ELSE 'AMBIGUOUS'
  END AS model_resolution_status
`;

// Detalle de Cliente - el `clientKey` recibido es ahora la clave canónica
// (UPPER(TRIM(client_name)), ver CLIENTS_CANONICAL_CTE), no un client_key
// físico exacto. Un cliente real puede tener VARIAS filas físicas en
// processed.fieldbeat_clients (client_key distinto) - se resuelven todas
// primero (nunca se asume una sola), y esas claves físicas son las que se
// usan para el FK real de equipment.client_key (processed.fieldbeat_equipments
// referencia el client_key físico de origen, no el nombre canónico - un
// equipo asociado a la fila "sin rut" de un cliente no debe desaparecer del
// detalle solo porque ahora navegamos por nombre).
export async function fetchClientDetail(clientKey: string) {
  const canonicalKey = clientKey.toUpperCase().trim();

  const [physicalRows, goldRows] = await Promise.all([
    runQuery<Record<string, unknown>>(
      `SELECT client_key, client_name, city, commune, country, address_raw
       FROM processed.fieldbeat_clients
       WHERE UPPER(TRIM(client_name)) = $1
       ORDER BY (address_raw IS NULL), client_key`,
      [canonicalKey]
    ),
    runQuery<Record<string, unknown>>(
      `SELECT COALESCE(total_tickets, 0) AS ticket_count, COALESCE(used_parts_count, 0) AS used_parts_count
       FROM gold.client_service_profile WHERE UPPER(TRIM(client_name)) = $1`,
      [canonicalKey]
    )
  ]);
  if (physicalRows.length === 0) return null;

  // Ya ordenado arriba para que la primera fila sea la de dirección real
  // cuando exista (misma regla que CLIENTS_CANONICAL_CTE) - representante
  // determinista para los campos de un solo valor (ciudad/comuna/país).
  const representative = physicalRows[0];
  const physicalKeys = physicalRows.map(row => row.client_key as string);
  const distinctAddresses = Array.from(new Set(physicalRows.map(row => row.address_raw).filter((value): value is string => Boolean(value))));

  // report_count se cuenta en vivo contra marts (no desde
  // gold.client_service_profile, que puede quedar desactualizado frente a la
  // carga más reciente - misma corrección ya aplicada en buildClientsListQuery/
  // enrichWithActiveIssueCounts, MISMA base acá para que listado y detalle
  // muestren siempre el mismo número) - agrupado por nombre canónico, nunca
  // por una sola fila física, para no perder reportes que solo coincidan con
  // la variante "sin rut" del cliente.
  const [equipmentRows, reportRows, reportCountRows] = await Promise.all([
    // Reutiliza EQUIPMENT_CANONICAL_CTE (misma identidad que el listado/
    // detalle de Equipos) - nunca vuelve a leer processed.fieldbeat_equipments
    // directo acá, o el "Equipos" de este cliente mostraría los mismos
    // duplicados de mayúsculas/uuid inestable que ya se corrigieron ahí.
    // Modelo/serie llegan por la MISMA cadena de identidad ya validada
    // (equipment_key canónico -> source_equipment_keys -> match_status
    // MATCHED de config.contract_equipment_analysis, EQUIPMENT_CONTRACT_
    // CANDIDATES_LATERAL) - nunca por nombre de cliente: confirmado que
    // config.contract_equipment_analysis.client_name_canonical usa una
    // convención de nombres completamente distinta a processed.
    // fieldbeat_clients.client_name (ninguna fila calza por UPPER(TRIM())),
    // así que un join directo por nombre de cliente fusionaría u omitiría
    // clientes arbitrariamente - el vínculo real y ya verificado es el de
    // equipo, no el de cliente.
    runQuery<Record<string, unknown>>(
      `${EQUIPMENT_CANONICAL_CTE}
       SELECT canonical_equipment.equipment_key, canonical_equipment.internal_id, canonical_equipment.equipment_type,
              ${EQUIPMENT_MODEL_RESOLUTION_COLUMNS},
              contract.equipment_models, contract.serial_numbers, contract.contract_status_codes, contract.match_statuses,
              contract.preventive_maintenance_mins, contract.preventive_maintenance_maxs, contract.preventive_maintenance_rules,
              COALESCE((
                SELECT SUM(g.fieldbeat_report_count) FROM gold.equipment_service_profile g
                WHERE UPPER(TRIM(g.equipment_internal_id)) = canonical_equipment.internal_id
              ), 0) AS report_count,
              (SELECT ARRAY_AGG(DISTINCT r.fieldbeat_task_id::text)
                 FROM marts.fieldbeat_report_dolibarr_operational_view r,
                      LATERAL UNNEST(STRING_TO_ARRAY(r.equipment_internal_ids, '|')) equipo
                 WHERE UPPER(TRIM(equipo)) = canonical_equipment.internal_id) AS report_task_ids
       FROM canonical_equipment
       ${EQUIPMENT_CONTRACT_CANDIDATES_LATERAL}
       WHERE canonical_equipment.client_key = $1
       ORDER BY canonical_equipment.internal_id LIMIT 20`,
      [canonicalKey]
    ),
    runQuery<Record<string, unknown>>(
      `SELECT fieldbeat_task_id, fieldbeat_task_date, task_type, linked_zendesk_ticket_id
       FROM marts.fieldbeat_report_dolibarr_operational_view WHERE UPPER(TRIM(client_name)) = $1
       ORDER BY fieldbeat_task_date DESC LIMIT 15`,
      [canonicalKey]
    ),
    runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view WHERE UPPER(TRIM(client_name)) = $1`, [canonicalKey])
  ]);

  const summary = {
    client_key: canonicalKey,
    client_name: representative.client_name,
    city: representative.city,
    commune: representative.commune,
    country: representative.country,
    address_raw: representative.address_raw,
    location_count: Math.max(distinctAddresses.length, 1),
    report_count: Number(reportCountRows[0]?.n ?? 0),
    ticket_count: Number(goldRows[0]?.ticket_count ?? 0),
    used_parts_count: Number(goldRows[0]?.used_parts_count ?? 0)
  };

  // Solo se expone una sección "Ubicaciones" cuando hay más de una dirección
  // real distinta (sedes genuinas, ej. ACME Santiago/Rancagua) - nunca para
  // el caso común de una fila duplicada con la misma dirección o con
  // dirección NULL, que no es una sede adicional.
  const locations =
    distinctAddresses.length > 1
      ? Array.from(new Map(physicalRows.filter(row => row.address_raw).map(row => [row.address_raw as string, row])).values())
      : [];

  // Mismo enriquecimiento de "Incidencias activas" que el listado de Equipos
  // (enrichWithActiveIssueCounts ya sabe resolverlo vía report_task_ids para
  // entity="equipment") - nunca una cuenta de incidencias reinventada acá.
  const equipmentRelated = await enrichWithActiveIssueCounts("equipment", serializeRows(equipmentRows));

  // "Contratos y cobertura" (sección 9) - deriva de la MISMA fila de equipo
  // ya traída arriba (contract_status_codes/match_statuses/preventive_maintenance_*),
  // nunca una consulta paralela ni un join por nombre de cliente. Cada
  // "contrato" acá ES la cobertura de un equipo (ver evidencia de grano junto
  // a CONTRACTS_FILTER_COLUMNS) - se lista uno por equipo, nunca se resume en
  // un solo "tipo de contrato" ni se suman horas/frecuencias entre equipos
  // distintos.
  const contractsCoverage = equipmentRelated.filter(row => Array.isArray(row.contract_status_codes) && row.contract_status_codes.length > 0);

  const summaryWithContracts = { ...summary, contract_equipment_count: contractsCoverage.length };

  return {
    summary: summaryWithContracts,
    related: {
      equipment: equipmentRelated,
      contractsCoverage,
      recentReports: serializeRows(reportRows),
      ...(locations.length > 1 ? { locations: serializeRows(locations) } : {})
    }
  };
}

// =============================================================================
// Equipos - identidad canónica vía EQUIPMENT_CANONICAL_CTE (arriba, define
// canonical_equipment y reutiliza canonical_clients - ver el comentario ahí
// para el hallazgo real de duplicación). Modelo/serie/estado de contrato se
// agregan desde config.contract_equipment_analysis vía
// EQUIPMENT_CONTRACT_CANDIDATES_LATERAL - EN EL LISTADO TAMBIÉN (a diferencia
// del diseño original, que lo omitía por costo): el modelo real es
// información de negocio de primer nivel (nunca solo "Tipo: LINAC" cuando
// existe un modelo real, ver EXPLORER_ENTITY_CONFIG.equipment), y la entidad
// tiene ~60 filas reales - el LATERAL de contratos por fila es costo
// despreciable a esta escala.
// =============================================================================
const EQUIPMENT_FILTER_COLUMNS = ["canonical_equipment.internal_id", "canonical_equipment.client_name", "canonical_equipment.equipment_type"];

export interface EquipmentExplorerFilters {
  client?: string;
  equipmentType?: string;
  model?: string;
  /** Vocabulario compartido con Contratos (8 valores, lib/contracts-vocabulary.ts
   * CONTRACT_STATUS_LABELS) - un equipo puede tener 2+ contratos vigentes en
   * desacuerdo (raro, ver EQUIPMENT_CONTRACT_CANDIDATES_LATERAL), por eso se
   * filtra contra el arreglo completo, no un valor resuelto único. */
  contractStatus?: string;
  /** Vocabulario compartido con Contratos (3 valores: MATCHED/UNMATCHED/
   * AMBIGUOUS, CONTRACT_MATCH_STATUS_LABELS). */
  linkStatus?: string;
  hasReports?: boolean;
  /** Universo de fieldbeat_task_id con incidencia activa (entity_type=
   * 'report') - ver fetchEntityKeysWithActiveIssues. */
  activeIssueTaskIds?: string[];
  hasActiveIssues?: boolean;
}

export function parseEquipmentFilters(searchParams: URLSearchParams): EquipmentExplorerFilters {
  return {
    client: searchParams.get("client") ?? undefined,
    equipmentType: searchParams.get("equipmentType") ?? undefined,
    model: searchParams.get("model") ?? undefined,
    contractStatus: searchParams.get("contractStatus") ?? undefined,
    linkStatus: searchParams.get("linkStatus") ?? undefined,
    hasReports: parseBooleanParam(searchParams.get("hasReports")),
    hasActiveIssues: parseBooleanParam(searchParams.get("hasActiveIssues"))
  };
}

// contract.* (arreglos de EQUIPMENT_CONTRACT_CANDIDATES_LATERAL) y el alias
// `model` (CASE de EQUIPMENT_MODEL_RESOLUTION_COLUMNS) solo existen DESPUÉS
// del LATERAL en el FROM - por eso este builder recibe conditions ya
// preparadas para ir después de EQUIPMENT_CONTRACT_CANDIDATES_LATERAL, nunca
// antes (a diferencia de las demás entidades, acá SÍ importa el orden).
function equipmentFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: EquipmentExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, EQUIPMENT_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.client) conditions.push(`canonical_equipment.client_name = ${pusher.push(extra.client)}`);
  if (extra?.equipmentType) conditions.push(`canonical_equipment.equipment_type = ${pusher.push(extra.equipmentType)}`);
  if (extra?.model) conditions.push(`${pusher.push(extra.model)} = ANY(contract.equipment_models)`);
  if (extra?.contractStatus) conditions.push(`${pusher.push(extra.contractStatus)} = ANY(contract.contract_status_codes)`);
  if (extra?.linkStatus) conditions.push(`${pusher.push(extra.linkStatus)} = ANY(contract.match_statuses)`);
  const hasReportsExists = `EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r2, LATERAL UNNEST(STRING_TO_ARRAY(r2.equipment_internal_ids, '|')) equipo
    WHERE UPPER(TRIM(equipo)) = canonical_equipment.internal_id)`;
  if (extra?.hasReports === true) conditions.push(hasReportsExists);
  if (extra?.hasReports === false) conditions.push(`NOT ${hasReportsExists}`);
  // pusher.push() SOLO dentro de la rama que lo usa - ver comentario
  // equivalente en ticketsFilterConditions (mismo bug real corregido en las
  // 3 entidades que lo tenían: tickets/clients/equipment).
  if (extra?.hasActiveIssues === true) {
    conditions.push(`EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r2, LATERAL UNNEST(STRING_TO_ARRAY(r2.equipment_internal_ids, '|')) equipo
      WHERE UPPER(TRIM(equipo)) = canonical_equipment.internal_id AND r2.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  }
  if (extra?.hasActiveIssues === false) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view r2, LATERAL UNNEST(STRING_TO_ARRAY(r2.equipment_internal_ids, '|')) equipo
      WHERE UPPER(TRIM(equipo)) = canonical_equipment.internal_id AND r2.fieldbeat_task_id::text = ANY(${pusher.push(extra.activeIssueTaskIds ?? [])}))`);
  }
  return conditions;
}

export function buildEquipmentListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: EquipmentExplorerFilters): SqlQuery {
  const cond = equipmentFilterConditions(pusher, filter, extra).join(" AND ");
  const sql = `
    ${EQUIPMENT_CANONICAL_CTE}
    SELECT canonical_equipment.equipment_key, canonical_equipment.internal_id, canonical_equipment.equipment_type,
           canonical_equipment.client_name,
           ${EQUIPMENT_MODEL_RESOLUTION_COLUMNS},
           contract.contract_status_codes,
           contract.match_statuses,
           contract.serial_numbers,
           contract.preventive_maintenance_mins,
           contract.preventive_maintenance_maxs,
           contract.preventive_maintenance_rules,
           -- SUM en vez de JOIN directo: gold.equipment_service_profile agrupa por
           -- internal_id CRUDO (misma inestabilidad de mayúsculas que el bug de
           -- arriba), así que puede tener más de una fila por equipo canónico -
           -- un LEFT JOIN plano multiplicaría de nuevo la fila; sumar sus conteos
           -- vía subconsulta escalar da el total real sin ese riesgo.
           COALESCE((
             SELECT SUM(g.fieldbeat_report_count) FROM gold.equipment_service_profile g
             WHERE UPPER(TRIM(g.equipment_internal_id)) = canonical_equipment.internal_id
           ), 0) AS report_count,
           (SELECT ARRAY_AGG(DISTINCT r.fieldbeat_task_id::text)
              FROM marts.fieldbeat_report_dolibarr_operational_view r,
                   LATERAL UNNEST(STRING_TO_ARRAY(r.equipment_internal_ids, '|')) equipo
              WHERE UPPER(TRIM(equipo)) = canonical_equipment.internal_id) AS report_task_ids
    FROM canonical_equipment
    ${EQUIPMENT_CONTRACT_CANDIDATES_LATERAL}
    ${cond ? `WHERE ${cond}` : ""}
    ORDER BY report_count DESC, canonical_equipment.internal_id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function fetchEquipmentTypeOptions(): Promise<string[]> {
  const rows = await runQuery<{ equipment_type: string }>(
    `SELECT DISTINCT equipment_type FROM processed.fieldbeat_equipments WHERE equipment_type IS NOT NULL AND TRIM(equipment_type) <> '' ORDER BY equipment_type`
  );
  return rows.map(r => r.equipment_type);
}

export async function fetchEquipmentModelOptions(): Promise<string[]> {
  const rows = await runQuery<{ model: string }>(
    `SELECT DISTINCT ca.equipment_model AS model FROM config.contract_equipment_analysis ca
     WHERE ca.is_current = true AND ca.equipment_model IS NOT NULL AND TRIM(ca.equipment_model) <> '' ORDER BY 1`
  );
  return rows.map(r => r.model);
}

export async function countEquipmentTotal(filter?: string, extra?: EquipmentExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const cond = equipmentFilterConditions(pusher, filter, extra).join(" AND ");
  const rows = await runQuery<{ n: string }>(
    `${EQUIPMENT_CANONICAL_CTE}
     SELECT COUNT(*) AS n FROM canonical_equipment
     ${EQUIPMENT_CONTRACT_CANDIDATES_LATERAL}
     ${cond ? `WHERE ${cond}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function fetchEquipmentDetail(equipmentKey: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `${EQUIPMENT_CANONICAL_CTE}
     SELECT canonical_equipment.equipment_key, canonical_equipment.internal_id, canonical_equipment.equipment_type,
            canonical_equipment.client_name, canonical_equipment.client_key, canonical_equipment.source_equipment_keys,
            ${EQUIPMENT_MODEL_RESOLUTION_COLUMNS},
            contract.equipment_models, contract.serial_numbers, contract.contract_status_codes,
            contract.warranty_end_dates, contract.match_statuses, contract.contract_keys, contract.contract_count,
            contract.preventive_maintenance_mins, contract.preventive_maintenance_maxs, contract.preventive_maintenance_rules
     FROM canonical_equipment
     ${EQUIPMENT_CONTRACT_CANDIDATES_LATERAL}
     WHERE canonical_equipment.equipment_key = $1`,
    [equipmentKey]
  );
  if (summaryRows.length === 0) return null;
  const internalId = summaryRows[0].internal_id as string;
  // report_count en vivo (mismo criterio que fetchClientDetail) - nunca el
  // agregado gold.equipment_service_profile, que puede quedar desactualizado.
  const [reportRows, reportCountRows] = await Promise.all([
    runQuery<Record<string, unknown>>(
      `SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, task_type
       FROM marts.fieldbeat_report_dolibarr_operational_view,
            LATERAL UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')) equipo
       WHERE UPPER(TRIM(equipo)) = UPPER(TRIM($1))
       ORDER BY fieldbeat_task_date DESC LIMIT 15`,
      [internalId]
    ),
    runQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view,
            LATERAL UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')) equipo
       WHERE UPPER(TRIM(equipo)) = UPPER(TRIM($1))`,
      [internalId]
    )
  ]);
  const summary = { ...serializeRows(summaryRows)[0], report_count: Number(reportCountRows[0]?.n ?? 0) };
  return {
    summary,
    related: { recentReports: serializeRows(reportRows) }
  };
}

// =============================================================================
// Técnicos - identidad canónica vía quality.fieldbeat_report_participants
// (normalized_name agrupa representaciones de origen distintas del MISMO
// participante dentro de un reporte) + manual_review.fieldbeat_engineer_identity_map
// para el nombre/verificación curados cuando existan (B46: participante sin
// mapeo se muestra con su representación de origen cruda, nunca una
// identidad inventada).
// =============================================================================
const TECHNICIANS_FILTER_COLUMNS = ["p.normalized_name", "p.raw_name"];

// Las 3 opciones (verificado/con reportes como responsable/con
// participación adicional) dependen de agregados (BOOL_OR/COUNT ... FILTER)
// calculados DESPUÉS de agrupar por p.normalized_name - van en HAVING, nunca
// en WHERE (mismo criterio que Repuestos, ver comentario en
// partsFilterConditions).
export interface TechniciansExplorerFilters {
  verified?: boolean;
  hasPrimaryReports?: boolean;
  hasParticipantReports?: boolean;
}

export function parseTechniciansFilters(searchParams: URLSearchParams): TechniciansExplorerFilters {
  return {
    verified: parseBooleanParam(searchParams.get("verified")),
    hasPrimaryReports: parseBooleanParam(searchParams.get("hasPrimaryReports")),
    hasParticipantReports: parseBooleanParam(searchParams.get("hasParticipantReports"))
  };
}

function techniciansHavingConditions(extra: TechniciansExplorerFilters | undefined): string[] {
  const having: string[] = [];
  if (extra?.verified === true) having.push(`BOOL_OR(m.verification_method = 'MANUALLY_VERIFIED')`);
  if (extra?.verified === false) having.push(`NOT BOOL_OR(m.verification_method = 'MANUALLY_VERIFIED')`);
  if (extra?.hasPrimaryReports === true) having.push(`COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE p.is_primary) > 0`);
  if (extra?.hasPrimaryReports === false) having.push(`COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE p.is_primary) = 0`);
  if (extra?.hasParticipantReports === true) having.push(`COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE NOT p.is_primary) > 0`);
  if (extra?.hasParticipantReports === false) having.push(`COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE NOT p.is_primary) = 0`);
  return having;
}

export function buildTechniciansListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: TechniciansExplorerFilters): SqlQuery {
  const cond = ilikeConditions(pusher, filter, TECHNICIANS_FILTER_COLUMNS);
  const filterClause = cond ? `AND (${cond})` : "";
  const having = techniciansHavingConditions(extra);
  const sql = `
    SELECT
      p.normalized_name,
      COALESCE(MAX(m.canonical_display_name), MAX(p.raw_name)) AS display_name,
      BOOL_OR(m.verification_method = 'MANUALLY_VERIFIED') AS is_manually_verified,
      COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE p.is_primary) AS primary_report_count,
      COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE NOT p.is_primary) AS participant_report_count
    FROM quality.fieldbeat_report_participants p
    LEFT JOIN manual_review.fieldbeat_engineer_identity_map m
      ON m.source_value_normalized = p.normalized_name AND m.is_active = true
    WHERE p.normalized_name IS NOT NULL
    ${filterClause}
    GROUP BY p.normalized_name
    ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
    ORDER BY primary_report_count DESC, p.normalized_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countTechniciansTotal(filter?: string, extra?: TechniciansExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, TECHNICIANS_FILTER_COLUMNS);
  const filterClause = cond ? `AND (${cond})` : "";
  const having = techniciansHavingConditions(extra);
  const sql = `
    SELECT COUNT(*) AS n FROM (
      SELECT p.normalized_name
      FROM quality.fieldbeat_report_participants p
      LEFT JOIN manual_review.fieldbeat_engineer_identity_map m
        ON m.source_value_normalized = p.normalized_name AND m.is_active = true
      WHERE p.normalized_name IS NOT NULL
      ${filterClause}
      GROUP BY p.normalized_name
      ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
    ) grouped
  `;
  const rows = await runQuery<{ n: string }>(sql, pusher.params);
  return Number(rows[0]?.n ?? 0);
}

export async function fetchTechnicianDetail(normalizedName: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `SELECT
       p.normalized_name,
       COALESCE(MAX(m.canonical_display_name), MAX(p.raw_name)) AS display_name,
       BOOL_OR(m.verification_method = 'MANUALLY_VERIFIED') AS is_manually_verified,
       COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE p.is_primary) AS primary_report_count,
       COUNT(DISTINCT p.fieldbeat_task_id) FILTER (WHERE NOT p.is_primary) AS participant_report_count
     FROM quality.fieldbeat_report_participants p
     LEFT JOIN manual_review.fieldbeat_engineer_identity_map m
       ON m.source_value_normalized = p.normalized_name AND m.is_active = true
     WHERE p.normalized_name = $1
     GROUP BY p.normalized_name`,
    [normalizedName]
  );
  if (summaryRows.length === 0) return null;
  // Representaciones de origen (B46) - solo contexto informativo para que
  // Administración vea de dónde viene el nombre antes de promoverlo a
  // identidad canónica. source_type acá es el vocabulario de
  // quality.fieldbeat_report_participants (TASK_ASSIGNED_TO/
  // REPORT_FIELD_STRUCTURED_VALUE/REPORT_FIELD_FREE_TEXT_COMMENT) - un
  // vocabulario DISTINTO del de manual_review.fieldbeat_engineer_identity_map
  // (ASSIGNED_TO_USERNAME/SIGNATURE_NAME/ADDITIONAL_FIELD_TOKEN). No existe
  // hoy un mapeo verificado 1:1 entre ambos en el código - por eso el
  // formulario de corrección pide el source_type de la tabla de identidad
  // explícitamente en vez de inferirlo, nunca inventando una correspondencia
  // no confirmada.
  const [reportRows, sourceRows] = await Promise.all([
    runQuery<Record<string, unknown>>(
      `SELECT p.fieldbeat_task_id, p.role, r.fieldbeat_task_date, r.client_name
       FROM quality.fieldbeat_report_participants p
       LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON r.fieldbeat_task_id = p.fieldbeat_task_id
       WHERE p.normalized_name = $1
       ORDER BY r.fieldbeat_task_date DESC LIMIT 15`,
      [normalizedName]
    ),
    runQuery<Record<string, unknown>>(
      `SELECT DISTINCT source_type, raw_name
       FROM quality.fieldbeat_report_participants
       WHERE normalized_name = $1
       ORDER BY source_type, raw_name LIMIT 10`,
      [normalizedName]
    )
  ]);
  return {
    summary: serializeRows(summaryRows)[0],
    related: { recentReports: serializeRows(reportRows), sourceRepresentations: serializeRows(sourceRows) }
  };
}

// =============================================================================
// Productos de catálogo - processed.dolibarr_products. cost_price EXCLUIDO
// SIEMPRE (margen interno, dato comercialmente sensible - B21/B29 punto 2,
// confirmado que la columna existe y por eso se excluye explícitamente en
// vez de dejarlo implícito). price (venta) solo en detalle, nunca en listado.
// =============================================================================
const PRODUCTS_FILTER_COLUMNS = ["ref", "label", "dolibarr_product_id::text"];

// cost_price EXCLUIDO SIEMPRE (ver comentario arriba) - ningún filtro/select
// de esta sección lo toca, ni siquiera para ordenar/comparar internamente.
// saleStatus/purchaseStatus filtran por el código NUMÉRICO crudo de Dolibarr
// (status/status_buy, bigint) - sin mapeo de etiqueta confirmado en este
// codebase, las opciones vienen de un facet DISTINCT (valores reales
// observados), nunca de una tabla de traducción inventada.
export interface ProductsExplorerFilters {
  saleStatus?: string;
  purchaseStatus?: string;
  hasUsageInReports?: boolean;
}

export function parseProductsFilters(searchParams: URLSearchParams): ProductsExplorerFilters {
  return {
    saleStatus: searchParams.get("saleStatus") ?? undefined,
    purchaseStatus: searchParams.get("purchaseStatus") ?? undefined,
    hasUsageInReports: parseBooleanParam(searchParams.get("hasUsageInReports"))
  };
}

function productsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: ProductsExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, PRODUCTS_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.saleStatus) conditions.push(`pr.status = ${pusher.push(extra.saleStatus)}::bigint`);
  if (extra?.purchaseStatus) conditions.push(`pr.status_buy = ${pusher.push(extra.purchaseStatus)}::bigint`);
  const usageExists = `EXISTS (SELECT 1 FROM marts.used_parts_dolibarr_match m WHERE m.dolibarr_ref = pr.ref)`;
  if (extra?.hasUsageInReports === true) conditions.push(usageExists);
  if (extra?.hasUsageInReports === false) conditions.push(`NOT ${usageExists}`);
  return conditions;
}

export function buildProductsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: ProductsExplorerFilters): SqlQuery {
  const conditions = productsFilterConditions(pusher, filter, extra);
  const sql = `
    SELECT pr.dolibarr_product_id, pr.ref, pr.label, pr.status
    FROM processed.dolibarr_products pr
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY pr.ref ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function fetchProductSaleStatusOptions(): Promise<string[]> {
  const rows = await runQuery<{ status: string }>(`SELECT DISTINCT status::text AS status FROM processed.dolibarr_products WHERE status IS NOT NULL ORDER BY 1`);
  return rows.map(r => r.status);
}

export async function fetchProductPurchaseStatusOptions(): Promise<string[]> {
  const rows = await runQuery<{ status_buy: string }>(`SELECT DISTINCT status_buy::text AS status_buy FROM processed.dolibarr_products WHERE status_buy IS NOT NULL ORDER BY 1`);
  return rows.map(r => r.status_buy);
}

export async function countProductsTotal(filter?: string, extra?: ProductsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const conditions = productsFilterConditions(pusher, filter, extra);
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM processed.dolibarr_products pr ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function fetchProductDetail(ref: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `SELECT dolibarr_product_id, ref, label, status, status_buy, price, date_creation
     FROM processed.dolibarr_products WHERE ref = $1`,
    [ref]
  );
  if (summaryRows.length === 0) return null;
  const usageRows = await runQuery<Record<string, unknown>>(
    `SELECT m.fieldbeat_task_id, r.fieldbeat_task_date, r.client_name
     FROM marts.used_parts_dolibarr_match m
     LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON r.fieldbeat_task_id = m.fieldbeat_task_id
     WHERE m.dolibarr_ref = $1
     ORDER BY r.fieldbeat_task_date DESC LIMIT 15`,
    [ref]
  );
  return {
    summary: serializeRows(summaryRows)[0],
    related: { recentUsages: serializeRows(usageRows) }
  };
}

// =============================================================================
// Contratos - único acceso permitido: config.contract_equipment_analysis
// (vista curada, ya excluye columnas raw/PII en su propia definición,
// sql/070_config.sql) - las tablas base de config.* siguen REVOKE'd, nunca
// se tocan directo. Listado acotado a is_current=true (la versión vigente
// por equipo, B20 - el historial de versiones queda para el detalle).
//
// Grano real confirmado por evidencia (no asumido): config.
// contract_equipment_versions.equipment_key (src/contracts/equipment-key.js,
// SN:<serie> o PROV:<hash de cliente+sede+modelo>) tiene un UNIQUE(equipment_key,
// valid_from) y NINGUNA fila apunta a un identificador de "contrato maestro"
// distinto - no existe una tabla de encabezado de contrato, ni una columna
// "N° Contrato" en el CSV origen (src/contracts/field-map.js, layout
// posicional completo leído: Cliente/Abreviación/Equipo/S-N/Año Instalación/
// Estado Contrato/SPA/Lun-Vie/Sab-Dom/Soporte/Horarios/HW Refresh/UpDates/
// UpGrades/Situación Repuestos/Q Mant Prev x Año/Notas - sin columna de
// número de contrato). El grano real y evidenciado es "una fila = la
// cobertura contractual de UN equipo específico" - por eso
// canonicalContractKey = equipment_key (el de contratos, namespace propio,
// distinto del equipment_key canónico de FieldBeat) y "Contrato" =
// "ContractEquipmentCoverage" son la MISMA cosa hoy en este dominio (no se
// inventa una entidad Contrato separada sin evidencia que la respalde).
// =============================================================================
const CONTRACTS_FILTER_COLUMNS = ["client_name_canonical", "equipment_model", "serial_number"];

// Vocabularios reales (lib/contracts-vocabulary.ts, ya validados contra el
// CHECK real de sql/070_config.sql): contractStatus (8 valores), spaTier (8),
// matchStatus (3, compartido con Equipos), partsCoverage (5). warrantyStatus
// es derivado (warranty_end_date vs now()), no una columna almacenada.
export interface ContractsExplorerFilters {
  client?: string;
  contractStatus?: string;
  spaTier?: string;
  serviceWeekday?: boolean;
  serviceWeekend?: boolean;
  matchStatus?: string;
  warrantyStatus?: "active" | "expired";
  partsCoverage?: string;
}

export function parseContractsFilters(searchParams: URLSearchParams): ContractsExplorerFilters {
  const warrantyStatus = searchParams.get("warrantyStatus");
  return {
    client: searchParams.get("client") ?? undefined,
    contractStatus: searchParams.get("contractStatus") ?? undefined,
    spaTier: searchParams.get("spaTier") ?? undefined,
    serviceWeekday: parseBooleanParam(searchParams.get("serviceWeekday")),
    serviceWeekend: parseBooleanParam(searchParams.get("serviceWeekend")),
    matchStatus: searchParams.get("matchStatus") ?? undefined,
    warrantyStatus: warrantyStatus === "active" || warrantyStatus === "expired" ? warrantyStatus : undefined,
    partsCoverage: searchParams.get("partsCoverage") ?? undefined
  };
}

function contractsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: ContractsExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, CONTRACTS_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.client) conditions.push(`client_name_canonical = ${pusher.push(extra.client)}`);
  if (extra?.contractStatus) conditions.push(`contract_status_code = ${pusher.push(extra.contractStatus)}`);
  if (extra?.spaTier) conditions.push(`spa_tier_code = ${pusher.push(extra.spaTier)}`);
  if (extra?.serviceWeekday !== undefined) conditions.push(`weekday_service = ${pusher.push(extra.serviceWeekday)}`);
  if (extra?.serviceWeekend !== undefined) conditions.push(`weekend_service = ${pusher.push(extra.serviceWeekend)}`);
  if (extra?.matchStatus) conditions.push(`match_status = ${pusher.push(extra.matchStatus)}`);
  if (extra?.warrantyStatus === "active") conditions.push(`warranty_end_date IS NOT NULL AND warranty_end_date >= now()`);
  if (extra?.warrantyStatus === "expired") conditions.push(`warranty_end_date IS NOT NULL AND warranty_end_date < now()`);
  if (extra?.partsCoverage) conditions.push(`parts_coverage_code = ${pusher.push(extra.partsCoverage)}`);
  return conditions;
}

export function buildContractsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string, extra?: ContractsExplorerFilters): SqlQuery {
  const conditions = ["is_current = true", ...contractsFilterConditions(pusher, filter, extra)];
  const sql = `
    SELECT equipment_key, client_name_canonical, site_abbreviation, equipment_model, serial_number,
           contract_status_code, spa_tier_code, weekday_service, weekend_service, warranty_end_date, match_status,
           parts_coverage_code, preventive_maintenance_min, preventive_maintenance_max, preventive_maintenance_rule
    FROM config.contract_equipment_analysis
    WHERE ${conditions.join(" AND ")}
    ORDER BY client_name_canonical ASC, equipment_model ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countContractsTotal(filter?: string, extra?: ContractsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const conditions = ["is_current = true", ...contractsFilterConditions(pusher, filter, extra)];
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM config.contract_equipment_analysis WHERE ${conditions.join(" AND ")}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function fetchContractDetail(equipmentKey: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `${EQUIPMENT_CANONICAL_CTE}
     SELECT ca.equipment_key, ca.client_name_canonical, ca.site_abbreviation, ca.equipment_model, ca.serial_number,
            ca.installation_month, ca.installation_date_precision, ca.contract_status_code, ca.spa_tier_code,
            ca.weekday_service, ca.weekend_service, ca.support_mode_code, ca.parts_coverage_code, ca.hw_refresh_code,
            ca.updates_code, ca.upgrades_code, ca.preventive_maintenance_min, ca.preventive_maintenance_max,
            ca.preventive_maintenance_rule, ca.warranty_end_date, ca.valid_from, ca.valid_to, ca.is_current,
            ca.match_status, ca.match_method, ca.fieldbeat_equipment_key, ca.fieldbeat_internal_id,
            -- Equipo canónico de FieldBeat al que este contrato quedó vinculado
            -- (subconsulta correlacionada, nunca ANY sobre una lista traída
            -- aparte) - solo no-NULL cuando match_status = MATCHED, ver
            -- EQUIPMENT_CANONICAL_CTE arriba para por qué se busca dentro de
            -- source_equipment_keys y no por igualdad exacta de equipment_key.
            (SELECT ce.equipment_key FROM canonical_equipment ce WHERE ca.fieldbeat_equipment_key = ANY(ce.source_equipment_keys)) AS linked_equipment_key
     FROM config.contract_equipment_analysis ca
     WHERE ca.equipment_key = $1 AND ca.is_current = true`,
    [equipmentKey]
  );
  if (summaryRows.length === 0) return null;
  const linkedEquipmentKey = summaryRows[0].linked_equipment_key as string | null;

  const [historyRows, coveredEquipmentRows] = await Promise.all([
    runQuery<Record<string, unknown>>(
      `SELECT contract_version_id, valid_from, valid_to, contract_status_code, spa_tier_code
       FROM config.contract_equipment_analysis WHERE equipment_key = $1 ORDER BY valid_from DESC LIMIT 10`,
      [equipmentKey]
    ),
    // "Equipos cubiertos" (sección 10) - en el grano real de hoy (ver
    // comentario arriba de CONTRACTS_FILTER_COLUMNS) es siempre 0 o 1 fila
    // (un contrato cubre exactamente el equipo con el que quedó vinculado),
    // pero se modela como lista para no asumir 1:1 si el dominio alguna vez
    // agrega una identidad de contrato-maestro real. Reutiliza la MISMA
    // identidad canónica de Equipos (nunca una consulta paralela).
    linkedEquipmentKey
      ? runQuery<Record<string, unknown>>(
          `${EQUIPMENT_CANONICAL_CTE}
           SELECT canonical_equipment.equipment_key, canonical_equipment.internal_id,
                  ${EQUIPMENT_MODEL_RESOLUTION_COLUMNS},
                  contract.serial_numbers, contract.match_statuses
           FROM canonical_equipment
           ${EQUIPMENT_CONTRACT_CANDIDATES_LATERAL}
           WHERE canonical_equipment.equipment_key = $1`,
          [linkedEquipmentKey]
        )
      : Promise.resolve([])
  ]);

  return {
    summary: serializeRows(summaryRows)[0],
    related: { versionHistory: serializeRows(historyRows), coveredEquipment: serializeRows(coveredEquipmentRows) }
  };
}

export function assertKnownEntity(entity: string): asserts entity is ExplorerEntity {
  const known: ExplorerEntity[] = ["clients", "equipment", "technicians", "reports", "tickets", "parts", "products", "contracts", "issues"];
  if (!known.includes(entity as ExplorerEntity)) {
    throw new Error(`Entidad de Explorador desconocida: "${entity}"`);
  }
}

// =============================================================================
// Contrato unificado de filtros (sección 14) - GET /api/explorer/[entity] y
// GET /api/explorer/[entity]/export llaman a ESTA MISMA función con los
// mismos searchParams (solo cambia limit/offset) - listado, conteo y
// exportación quedan estructuralmente imposibilitados de divergir, en vez de
// depender de que cada ruta parseara sus filtros por separado (lo que
// pasaba antes de esta sección: cada entidad tenía su propio bloque
// duplicado en route.ts y export/route.ts).
// =============================================================================
export interface ExplorerQueryResult {
  rows: Record<string, unknown>[];
  total: number;
}

export async function resolveExplorerEntityQuery(
  entity: ExplorerEntity,
  searchParams: URLSearchParams,
  limit: number,
  offset: number
): Promise<ExplorerQueryResult> {
  const filter = searchParams.get("q")?.trim() || undefined;

  if (entity === "issues") {
    const issuesFilters = parseIssuesFilters(searchParams);
    const { rows, total } = await fetchIssuesList(limit, offset, filter, issuesFilters);
    return { rows, total };
  }

  if (entity === "reports") {
    const reportsFilters = parseReportsFilters(searchParams);
    if (reportsFilters.hasActiveIssues !== undefined) {
      reportsFilters.activeIssueTaskIds = await fetchEntityKeysWithActiveIssues("report");
    }
    const pusher = createParamPusher();
    const query = buildReportsListQuery(pusher, limit, offset, filter, reportsFilters);
    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countReportsTotal(filter, reportsFilters)]);
    const enriched = await enrichWithActiveIssueCounts("reports", serializeRows(rows));
    return { rows: enriched, total };
  }

  if (entity === "tickets") {
    const ticketsFilters = parseTicketsFilters(searchParams);
    if (ticketsFilters.hasActiveIssues !== undefined) {
      ticketsFilters.activeIssueTaskIds = await fetchEntityKeysWithActiveIssues("ticket_link");
    }
    const pusher = createParamPusher();
    const query = buildTicketsListQuery(pusher, limit, offset, filter, ticketsFilters);
    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countTicketsTotal(filter, ticketsFilters)]);
    const enriched = await enrichWithActiveIssueCounts("tickets", serializeRows(rows));
    return { rows: enriched, total };
  }

  if (entity === "parts") {
    const partsFilters = parsePartsFilters(searchParams);
    if (partsFilters.hasActiveIssues !== undefined) {
      partsFilters.activeIssueUsedPartIds = await fetchOccurrenceKeysWithActiveIssues("part_occurrence");
    }
    const pusher = createParamPusher();
    const query = buildPartsListQuery(pusher, limit, offset, filter, partsFilters);
    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countPartsTotal(filter, partsFilters)]);
    const enriched = await enrichWithActiveIssueCounts("parts", serializeRows(rows));
    return { rows: enriched, total };
  }

  if (entity === "clients") {
    const clientsFilters = parseClientsFilters(searchParams);
    if (clientsFilters.hasActiveIssues !== undefined) {
      clientsFilters.activeIssueTaskIds = await fetchEntityKeysWithActiveIssues("report");
    }
    const pusher = createParamPusher();
    const query = buildClientsListQuery(pusher, limit, offset, filter, clientsFilters);
    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countClientsTotal(filter, clientsFilters)]);
    const enriched = await enrichWithActiveIssueCounts("clients", serializeRows(rows));
    return { rows: enriched, total };
  }

  if (entity === "equipment") {
    const equipmentFilters = parseEquipmentFilters(searchParams);
    if (equipmentFilters.hasActiveIssues !== undefined) {
      equipmentFilters.activeIssueTaskIds = await fetchEntityKeysWithActiveIssues("report");
    }
    const pusher = createParamPusher();
    const query = buildEquipmentListQuery(pusher, limit, offset, filter, equipmentFilters);
    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countEquipmentTotal(filter, equipmentFilters)]);
    const enriched = await enrichWithActiveIssueCounts("equipment", serializeRows(rows));
    return { rows: enriched, total };
  }

  if (entity === "technicians") {
    const techniciansFilters = parseTechniciansFilters(searchParams);
    const pusher = createParamPusher();
    const query = buildTechniciansListQuery(pusher, limit, offset, filter, techniciansFilters);
    const [rows, total] = await Promise.all([
      runQuery<Record<string, unknown>>(query.sql, query.params),
      countTechniciansTotal(filter, techniciansFilters)
    ]);
    return { rows: serializeRows(rows), total };
  }

  if (entity === "products") {
    const productsFilters = parseProductsFilters(searchParams);
    const pusher = createParamPusher();
    const query = buildProductsListQuery(pusher, limit, offset, filter, productsFilters);
    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countProductsTotal(filter, productsFilters)]);
    return { rows: serializeRows(rows), total };
  }

  if (entity === "contracts") {
    const contractsFilters = parseContractsFilters(searchParams);
    const pusher = createParamPusher();
    const query = buildContractsListQuery(pusher, limit, offset, filter, contractsFilters);
    const [rows, total] = await Promise.all([
      runQuery<Record<string, unknown>>(query.sql, query.params),
      countContractsTotal(filter, contractsFilters)
    ]);
    return { rows: serializeRows(rows), total };
  }

  throw new Error(`Entidad sin consulta implementada: ${entity}`);
}
