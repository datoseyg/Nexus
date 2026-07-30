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

export function buildClientsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, CLIENTS_FILTER_COLUMNS);
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
    ${cond ? `WHERE ${cond}` : ""}
    ORDER BY report_count DESC, canonical_clients.client_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

export async function countClientsTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, CLIENTS_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(
    `${CLIENTS_CANONICAL_CTE} SELECT COUNT(*) AS n FROM canonical_clients ${cond ? `WHERE ${cond}` : ""}`,
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

export function buildEquipmentListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, EQUIPMENT_FILTER_COLUMNS);
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

export async function countEquipmentTotal(filter?: string): Promise<number> {
  const pusher = createParamPusher();
  const cond = ilikeConditions(pusher, filter, EQUIPMENT_FILTER_COLUMNS);
  const rows = await runQuery<{ n: string }>(
    `${EQUIPMENT_CANONICAL_CTE} SELECT COUNT(*) AS n FROM canonical_equipment ${cond ? `WHERE ${cond}` : ""}`,
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
const PRODUCTS_FILTER_COLUMNS = ["ref", "label", "dolibarr_product_id::text"];

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

export function buildContractsListQuery(pusher: ParamPusher, limit: number, offset: number, filter?: string): SqlQuery {
  const cond = ilikeConditions(pusher, filter, CONTRACTS_FILTER_COLUMNS);
  const sql = `
    SELECT equipment_key, client_name_canonical, site_abbreviation, equipment_model, serial_number,
           contract_status_code, spa_tier_code, weekday_service, weekend_service, warranty_end_date, match_status,
           preventive_maintenance_min, preventive_maintenance_max, preventive_maintenance_rule
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
