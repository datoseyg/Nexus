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

// Un solo placeholder ILIKE reutilizado en todas las columnas (Postgres
// permite referenciar el mismo parámetro posicional más de una vez) - el
// caller decide el conector ("WHERE ..."/"AND (...)") según si la query ya
// trae una cláusula previa. Reemplaza el patrón de reconstruir el mismo
// fragmento ILIKE por separado en cada build*Query/count*Total.
function ilikeConditions(pusher: ParamPusher, filter: string | undefined, columns: string[]): string {
  if (!filter) return "";
  const placeholder = pusher.push(`%${filter}%`);
  return columns.map(col => `${col} ILIKE ${placeholder}`).join(" OR ");
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
export async function fetchActiveIssueCountsByKey(entityType: string | null, entityKeys: string[]): Promise<Map<string, number>> {
  if (entityKeys.length === 0) return new Map();
  const rows = await runGovernanceQuery<{ entity_key: string; n: string }>(
    "app_read",
    `SELECT entity_key, COUNT(*) AS n FROM governance.issues
     WHERE ($1::text IS NULL OR entity_type = $1) AND entity_key = ANY($2) AND status IN ('OPEN','IN_REVIEW')
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
     WHERE entity_type = $1 AND occurrence_key = ANY($2) AND status IN ('OPEN','IN_REVIEW')
     GROUP BY occurrence_key`,
    [entityType, occurrenceKeys]
  );
  return new Map(rows.map(row => [row.occurrence_key, Number(row.n)]));
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
}

function reportsFilterConditions(pusher: ParamPusher, filter: string | undefined, extra: ReportsExplorerFilters | undefined): string[] {
  const conditions: string[] = [];
  const cond = ilikeConditions(pusher, filter, REPORTS_FILTER_COLUMNS);
  if (cond) conditions.push(cond);
  if (extra?.client) conditions.push(`client_name = ${pusher.push(extra.client)}`);
  if (extra?.taskType) conditions.push(`task_type = ${pusher.push(extra.taskType)}`);
  if (extra?.dateFrom) conditions.push(`fieldbeat_task_date >= ${pusher.push(extra.dateFrom)}::date`);
  if (extra?.dateTo) conditions.push(`fieldbeat_task_date <= ${pusher.push(extra.dateTo)}::date`);
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
           r.equipment_internal_ids, r.linked_zendesk_ticket_id, r.used_parts_count
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

export async function countReportsTotal(filter?: string, extra?: ReportsExplorerFilters): Promise<number> {
  const pusher = createParamPusher();
  const conditions = reportsFilterConditions(pusher, filter, extra);
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

// =============================================================================
// Tickets - reutiliza processed.zendesk_tickets + el detalle ya probado de
// Búsqueda (buildTicketDetailSummaryQuery/buildTicketDetailRelatedQuery).
// =============================================================================
const TICKETS_FILTER_COLUMNS = ["COALESCE(z.subject, z.raw_subject)", "CAST(z.zendesk_ticket_id AS text)"];

export function buildTicketsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, TICKETS_FILTER_COLUMNS);
  const sql = `
    SELECT z.zendesk_ticket_id, z.status, COALESCE(z.subject, z.raw_subject) AS title, z.created_at,
      (SELECT COUNT(DISTINCT r.fieldbeat_task_id) FROM marts.fieldbeat_report_dolibarr_operational_view r
        WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text) AS linked_report_count,
      (SELECT ARRAY_AGG(r.fieldbeat_task_id::text) FROM marts.fieldbeat_report_dolibarr_operational_view r
        WHERE TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text) AS linked_task_ids
    FROM processed.zendesk_tickets z
    ${cond ? `WHERE ${cond}` : ""}
    ORDER BY z.created_at DESC, z.zendesk_ticket_id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countTicketsTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, TICKETS_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM processed.zendesk_tickets z ${cond ? `WHERE ${cond}` : ""}`, pusher.params);
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

export function buildPartsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, PARTS_FILTER_COLUMNS);
  const sql = `
    SELECT
      ${PARTS_IDENTITY_EXPR} AS part_key,
      MAX(m.dolibarr_ref) AS dolibarr_ref,
      COALESCE(MAX(m.dolibarr_label), MAX(m.part_name)) AS part_name,
      MAX(m.raw_part_identifier) AS raw_part_identifier,
      MAX(COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier)))) AS normalized_identifier,
      MAX(m.used_part_id) AS used_part_id,
      ARRAY_AGG(DISTINCT m.used_part_id::text) AS used_part_ids,
      SUM(COALESCE(p.quantity, 1)) AS quantity_consumed,
      COUNT(DISTINCT m.fieldbeat_task_id) AS report_count,
      COUNT(DISTINCT r.client_name) AS client_count
    FROM marts.used_parts_dolibarr_match m
    LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
    LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
    ${cond ? `WHERE ${cond}` : ""}
    GROUP BY ${PARTS_IDENTITY_EXPR}
    ORDER BY quantity_consumed DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countPartsTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, PARTS_FILTER_COLUMNS);
  const sql = `SELECT COUNT(DISTINCT ${PARTS_IDENTITY_EXPR}) AS n FROM marts.used_parts_dolibarr_match m ${cond ? `WHERE ${cond}` : ""}`;
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
export interface IssuesExplorerFilters {
  severity?: string;
  status?: string;
  entityType?: string;
}

export async function fetchIssuesList(
  limit: number,
  offset: number,
  filter?: string,
  extra?: IssuesExplorerFilters
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const params: unknown[] = [];
  const conditions: string[] = [];
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
      `SELECT COUNT(*) AS n FROM governance.issues i LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version ${where}`,
      params
    )
  ]);
  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
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
const CLIENTS_FILTER_COLUMNS = ["c.client_name", "c.city"];

export function buildClientsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, CLIENTS_FILTER_COLUMNS);
  const sql = `
    SELECT
      c.client_key, c.client_name, c.city, c.commune, c.country,
      COALESCE(g.fieldbeat_report_count, 0) AS report_count,
      COALESCE(g.total_tickets, 0) AS ticket_count,
      (SELECT ARRAY_AGG(r.fieldbeat_task_id::text) FROM marts.fieldbeat_report_dolibarr_operational_view r
        WHERE r.client_name = c.client_name) AS report_task_ids
    FROM processed.fieldbeat_clients c
    LEFT JOIN gold.client_service_profile g ON g.client_name = c.client_name
    ${cond ? `WHERE ${cond}` : ""}
    ORDER BY report_count DESC, c.client_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countClientsTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, CLIENTS_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM processed.fieldbeat_clients c ${cond ? `WHERE ${cond}` : ""}`, pusher.params);
  return Number(rows[0]?.n ?? 0);
}

export async function fetchClientDetail(clientKey: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `SELECT c.client_key, c.client_name, c.city, c.commune, c.country, c.address_raw,
            COALESCE(g.total_tickets, 0) AS ticket_count,
            COALESCE(g.used_parts_count, 0) AS used_parts_count
     FROM processed.fieldbeat_clients c
     LEFT JOIN gold.client_service_profile g ON g.client_name = c.client_name
     WHERE c.client_key = $1`,
    [clientKey]
  );
  if (summaryRows.length === 0) return null;
  const clientName = summaryRows[0].client_name as string;
  // report_count se cuenta en vivo contra marts (no desde gold.client_service_profile,
  // que puede quedar desactualizado frente a la carga más reciente - confirmado real
  // durante la corrección de fidelidad visual: la misma inconsistencia se corrigió
  // en buildClientsListQuery/enrichWithActiveIssueCounts, MISMA base acá para que
  // listado y detalle muestren siempre el mismo número).
  const [equipmentRows, reportRows, reportCountRows] = await Promise.all([
    runQuery<Record<string, unknown>>(
      `SELECT equipment_key, internal_id, equipment_type FROM processed.fieldbeat_equipments WHERE client_key = $1 ORDER BY internal_id LIMIT 20`,
      [clientKey]
    ),
    runQuery<Record<string, unknown>>(
      `SELECT fieldbeat_task_id, fieldbeat_task_date, task_type, linked_zendesk_ticket_id
       FROM marts.fieldbeat_report_dolibarr_operational_view WHERE client_name = $1
       ORDER BY fieldbeat_task_date DESC LIMIT 15`,
      [clientName]
    ),
    runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM marts.fieldbeat_report_dolibarr_operational_view WHERE client_name = $1`, [clientName])
  ]);
  const summary = { ...serializeRows(summaryRows)[0], report_count: Number(reportCountRows[0]?.n ?? 0) };
  return {
    summary,
    related: { equipment: serializeRows(equipmentRows), recentReports: serializeRows(reportRows) }
  };
}

// =============================================================================
// Equipos - processed.fieldbeat_equipments (fuente estructurada real, B20).
// Modelo/serie NO viven acá - se unen desde config.contract_equipment_analysis
// (fieldbeat_equipment_key/fieldbeat_internal_id) solo en el detalle, nunca
// en el listado (evita un JOIN caro por fila y mantiene el listado a
// columnas propias de la entidad).
// =============================================================================
const EQUIPMENT_FILTER_COLUMNS = ["e.internal_id", "c.client_name", "e.equipment_type"];

export function buildEquipmentListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, EQUIPMENT_FILTER_COLUMNS);
  const sql = `
    SELECT e.equipment_key, e.internal_id, e.equipment_type, c.client_name,
           COALESCE(g.fieldbeat_report_count, 0) AS report_count,
           (SELECT ARRAY_AGG(DISTINCT r.fieldbeat_task_id::text)
              FROM marts.fieldbeat_report_dolibarr_operational_view r,
                   LATERAL UNNEST(STRING_TO_ARRAY(r.equipment_internal_ids, '|')) equipo
              WHERE UPPER(TRIM(equipo)) = UPPER(TRIM(e.internal_id))) AS report_task_ids
    FROM processed.fieldbeat_equipments e
    LEFT JOIN processed.fieldbeat_clients c ON c.client_key = e.client_key
    LEFT JOIN gold.equipment_service_profile g ON g.equipment_internal_id = e.internal_id
    ${cond ? `WHERE ${cond}` : ""}
    ORDER BY report_count DESC, e.internal_id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countEquipmentTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, EQUIPMENT_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM processed.fieldbeat_equipments e LEFT JOIN processed.fieldbeat_clients c ON c.client_key = e.client_key ${cond ? `WHERE ${cond}` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function fetchEquipmentDetail(equipmentKey: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `SELECT e.equipment_key, e.internal_id, e.equipment_type, c.client_name,
            ca.equipment_model, ca.serial_number, ca.contract_status_code, ca.warranty_end_date
     FROM processed.fieldbeat_equipments e
     LEFT JOIN processed.fieldbeat_clients c ON c.client_key = e.client_key
     LEFT JOIN config.contract_equipment_analysis ca ON ca.fieldbeat_equipment_key = e.equipment_key AND ca.is_current = true
     WHERE e.equipment_key = $1`,
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

export function buildTechniciansListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, TECHNICIANS_FILTER_COLUMNS);
  const filterClause = cond ? `AND (${cond})` : "";
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
    ORDER BY primary_report_count DESC, p.normalized_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countTechniciansTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, TECHNICIANS_FILTER_COLUMNS);
  const filterClause = cond ? `AND (${cond})` : "";
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(DISTINCT p.normalized_name) AS n FROM quality.fieldbeat_report_participants p WHERE p.normalized_name IS NOT NULL ${filterClause}`,
    pusher.params
  );
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
const PRODUCTS_FILTER_COLUMNS = ["ref", "label"];

export function buildProductsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, PRODUCTS_FILTER_COLUMNS);
  const sql = `
    SELECT dolibarr_product_id, ref, label, status
    FROM processed.dolibarr_products
    ${cond ? `WHERE ${cond}` : ""}
    ORDER BY ref ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countProductsTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, PRODUCTS_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM processed.dolibarr_products ${cond ? `WHERE ${cond}` : ""}`, pusher.params);
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
// =============================================================================
const CONTRACTS_FILTER_COLUMNS = ["client_name_canonical", "equipment_model", "serial_number"];

export function buildContractsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, CONTRACTS_FILTER_COLUMNS);
  const sql = `
    SELECT equipment_key, client_name_canonical, site_abbreviation, equipment_model, serial_number,
           contract_status_code, spa_tier_code, weekday_service, weekend_service, warranty_end_date, match_status
    FROM config.contract_equipment_analysis
    WHERE is_current = true
    ${cond ? `AND (${cond})` : ""}
    ORDER BY client_name_canonical ASC, equipment_model ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countContractsTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, CONTRACTS_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM config.contract_equipment_analysis WHERE is_current = true ${cond ? `AND (${cond})` : ""}`,
    pusher.params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function fetchContractDetail(equipmentKey: string) {
  const summaryRows = await runQuery<Record<string, unknown>>(
    `SELECT equipment_key, client_name_canonical, site_abbreviation, equipment_model, serial_number,
            installation_month, installation_date_precision, contract_status_code, spa_tier_code,
            weekday_service, weekend_service, support_mode_code, parts_coverage_code, hw_refresh_code,
            updates_code, upgrades_code, preventive_maintenance_min, preventive_maintenance_max,
            preventive_maintenance_rule, warranty_end_date, valid_from, valid_to, is_current,
            match_status, match_method, fieldbeat_equipment_key, fieldbeat_internal_id
     FROM config.contract_equipment_analysis WHERE equipment_key = $1 AND is_current = true`,
    [equipmentKey]
  );
  if (summaryRows.length === 0) return null;
  const historyRows = await runQuery<Record<string, unknown>>(
    `SELECT contract_version_id, valid_from, valid_to, contract_status_code, spa_tier_code
     FROM config.contract_equipment_analysis WHERE equipment_key = $1 ORDER BY valid_from DESC LIMIT 10`,
    [equipmentKey]
  );
  return {
    summary: serializeRows(summaryRows)[0],
    related: { versionHistory: serializeRows(historyRows) }
  };
}

export function assertKnownEntity(entity: string): asserts entity is ExplorerEntity {
  const known: ExplorerEntity[] = ["clients", "equipment", "technicians", "reports", "tickets", "parts", "products", "contracts", "issues"];
  if (!known.includes(entity as ExplorerEntity)) {
    throw new Error(`Entidad de Explorador desconocida: "${entity}"`);
  }
}
