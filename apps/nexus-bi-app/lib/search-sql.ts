// SQL de la Búsqueda global (ETAPA 8). Todo parametrizado ($N vía
// ParamPusher), sin interpolar texto de usuario como SQL. Evidencia de
// columnas confirmada por discovery gate en vivo (GET /api/tables/**)
// contra la base real, no supuesta:
//
// processed.zendesk_tickets: zendesk_ticket_id(bigint), subject(text),
//   raw_subject(text), description(text), status(text),
//   created_at(timestamptz)
// marts.fieldbeat_report_dolibarr_operational_view: fieldbeat_task_id(bigint),
//   fieldbeat_task_date(timestamptz), client_name(text), task_type(text),
//   equipment_internal_ids(text), linked_zendesk_ticket_id(text),
//   used_parts_count(bigint)
// processed.fieldbeat_tasks: fieldbeat_task_id(bigint), description(text)
// marts.used_parts_dolibarr_match: used_part_id(text), fieldbeat_task_id(bigint),
//   dolibarr_ref(text), dolibarr_label(text), part_name(text),
//   raw_part_identifier(text), normalized_part_identifier(text),
//   match_status(text)
// processed.fieldbeat_used_parts: used_part_id(text), fieldbeat_task_id(bigint),
//   quantity(bigint)
// processed.fieldbeat_report_fields: fieldbeat_task_id(bigint), field_name(text),
//   field_value(text) - disponibilidad verificada vía to_regclass, ver
//   getReportFieldsAvailability().
//
// Título de ticket: allowlist cerrada y hardcodeada (nunca un nombre de
// columna interpolado desde el request) - subject/raw_subject confirmados
// reales por el discovery gate.
import { runQuery } from "./db";
import {
  buildConRepuestoCondition,
  buildReportDateConditions,
  buildReportIdentityConditions,
  createParamPusher,
  type ParamPusher,
  type SearchFilters
} from "./search-filters";
import type { SearchEntity, SearchPartResult, SearchReportResult, SearchTicketResult } from "@/types/search";

const TICKET_TITLE_EXPR = "COALESCE(z.subject, z.raw_subject)";

// --- Normalización numérica explícita (nunca confiar ciegamente en el
// bigint->Number genérico de serializeRows para conteos/cantidades) ---
export function toSafeCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    console.warn(`[search-sql] conteo no seguro recibido de SQL: ${String(value)}`);
    return 0;
  }
  return n;
}

export function toSafeQuantity(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[search-sql] cantidad no segura recibida de SQL: ${String(value)}`);
    return 0;
  }
  return n;
}

// --- Capability check: processed.fieldbeat_report_fields ---
let reportFieldsAvailableCache: boolean | null = null;

export async function getReportFieldsAvailability(): Promise<boolean> {
  if (reportFieldsAvailableCache !== null) return reportFieldsAvailableCache;
  const rows = await runQuery<{ available: boolean }>(
    `SELECT to_regclass('processed.fieldbeat_report_fields') IS NOT NULL AS available`
  );
  reportFieldsAvailableCache = rows[0]?.available ?? false;
  return reportFieldsAvailableCache;
}

// --- Medición y conteo de queries por request ---
export interface QueryTiming {
  label: string;
  ms: number;
}
export interface QueryTimer {
  timed<T>(label: string, fn: () => Promise<T>): Promise<T>;
  timings: QueryTiming[];
  count: () => number;
}
export function createQueryTimer(): QueryTimer {
  const timings: QueryTiming[] = [];
  let count = 0;
  return {
    async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
      count += 1;
      const start = Date.now();
      const result = await fn();
      timings.push({ label, ms: Date.now() - start });
      return result;
    },
    timings,
    count: () => count
  };
}

// --- CTEs base ---

/** filtered_reports: filtros comunes CON fecha - base de reports/clients/machines. */
export function buildFilteredReportsCte(filters: SearchFilters, pusher: ParamPusher): string {
  const conditions = [
    ...buildReportDateConditions(filters, "m", pusher),
    ...buildReportIdentityConditions(filters, "m", pusher)
  ];
  const conRepuesto = buildConRepuestoCondition(filters.conRepuesto, "m");
  if (conRepuesto) conditions.push(conRepuesto);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return `filtered_reports AS (
    SELECT m.fieldbeat_task_id, m.fieldbeat_task_date, m.client_name, m.task_type,
           m.equipment_internal_ids, m.linked_zendesk_ticket_id, m.used_parts_count, t.description
    FROM marts.fieldbeat_report_dolibarr_operational_view m
    JOIN processed.fieldbeat_tasks t ON m.fieldbeat_task_id = t.fieldbeat_task_id
    ${where}
  )`;
}

/** bridge_reports: filtros comunes SIN fecha - usado solo por el bridge de tickets. */
export function buildBridgeReportsCte(filters: SearchFilters, pusher: ParamPusher): string {
  const conditions = buildReportIdentityConditions(filters, "m", pusher);
  const conRepuesto = buildConRepuestoCondition(filters.conRepuesto, "m");
  if (conRepuesto) conditions.push(conRepuesto);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return `bridge_reports AS (
    SELECT m.fieldbeat_task_id, m.client_name, m.equipment_internal_ids, m.linked_zendesk_ticket_id
    FROM marts.fieldbeat_report_dolibarr_operational_view m
    ${where}
  )`;
}

function hasTicketBridgeFilters(filters: SearchFilters): boolean {
  return Boolean(filters.cliente || filters.maquina || filters.tipoTarea || filters.conRepuesto !== "all");
}

// --- Condiciones de coincidencia por entidad (misma función reutilizada entre conteo/preview/página) ---

export function buildReportsTokenConditions(tokens: string[], pusher: ParamPusher, reportFieldsAvailable: boolean): string[] {
  return tokens.map(token => {
    const p = pusher.push(`%${token}%`);
    const parts = [
      `fr.fieldbeat_task_id::text ILIKE ${p}`,
      `fr.client_name ILIKE ${p}`,
      `fr.task_type ILIKE ${p}`,
      `fr.description ILIKE ${p}`,
      `fr.equipment_internal_ids ILIKE ${p}`,
      `fr.linked_zendesk_ticket_id ILIKE ${p}`
    ];
    if (reportFieldsAvailable) {
      parts.push(
        `EXISTS (SELECT 1 FROM processed.fieldbeat_report_fields rf WHERE rf.fieldbeat_task_id = fr.fieldbeat_task_id AND rf.field_value ILIKE ${p})`
      );
    }
    return `(${parts.join(" OR ")})`;
  });
}

export function buildClientsTokenConditions(tokens: string[], pusher: ParamPusher): string[] {
  return tokens.map(token => `fr.client_name ILIKE ${pusher.push(`%${token}%`)}`);
}

export function buildMachinesTokenConditions(tokens: string[], pusher: ParamPusher): string[] {
  return tokens.map(token => {
    const p = pusher.push(`%${token}%`);
    return `(equipo ILIKE ${p} OR fr.client_name ILIKE ${p})`;
  });
}

export function buildTicketsTokenConditions(tokens: string[], pusher: ParamPusher): string[] {
  return tokens.map(token => {
    const p = pusher.push(`%${token}%`);
    return `(z.zendesk_ticket_id::text ILIKE ${p} OR ${TICKET_TITLE_EXPR} ILIKE ${p} OR z.status ILIKE ${p} OR z.description ILIKE ${p} OR EXISTS (SELECT 1 FROM bridge_reports br WHERE TRIM(br.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text AND br.client_name ILIKE ${p}))`;
  });
}

export function buildPartsTokenConditions(tokens: string[], pusher: ParamPusher): string[] {
  return tokens.map(token => {
    const p = pusher.push(`%${token}%`);
    return `(m.dolibarr_ref ILIKE ${p} OR m.dolibarr_label ILIKE ${p} OR m.part_name ILIKE ${p} OR m.raw_part_identifier ILIKE ${p} OR r.client_name ILIKE ${p})`;
  });
}

function ticketDateAndStatusConditions(filters: SearchFilters, pusher: ParamPusher): string[] {
  const conditions: string[] = [];
  if (filters.from) conditions.push(`CAST(z.created_at AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(z.created_at AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  if (filters.estadoTicket) conditions.push(`z.status ILIKE ${pusher.push(`%${filters.estadoTicket}%`)}`);
  return conditions;
}

function partsFilterConditions(filters: SearchFilters, pusher: ParamPusher): string[] {
  // Filtros comunes vía join a r (mart), fecha por r.fieldbeat_task_date del
  // reporte unido - filas de parte sin reporte unido quedan excluidas
  // cuando el filtro de fecha está activo (documentado, no oculto).
  const conditions = [...buildReportDateConditions(filters, "r", pusher), ...buildReportIdentityConditions(filters, "r", pusher)];
  const conRepuesto = buildConRepuestoCondition(filters.conRepuesto, "r");
  if (conRepuesto) conditions.push(conRepuesto);
  return conditions;
}

// --- Consulta de conteos consolidada (1 sola query, 5 subconsultas escalares) ---

export interface SqlQuery {
  sql: string;
  params: unknown[];
}

export function buildConsolidatedCountsQuery(
  filters: SearchFilters,
  tokens: string[],
  reportFieldsAvailable: boolean,
  pusher: ParamPusher
): SqlQuery {
  const cte = [buildFilteredReportsCte(filters, pusher), buildBridgeReportsCte(filters, pusher)].join(",\n");

  const reportsWhere = buildReportsTokenConditions(tokens, pusher, reportFieldsAvailable).join(" AND ");
  const clientsWhere = buildClientsTokenConditions(tokens, pusher).join(" AND ");
  const machinesWhere = buildMachinesTokenConditions(tokens, pusher).join(" AND ");

  const ticketConditions = [...ticketDateAndStatusConditions(filters, pusher), ...buildTicketsTokenConditions(tokens, pusher)];
  if (hasTicketBridgeFilters(filters)) {
    ticketConditions.push(`EXISTS (SELECT 1 FROM bridge_reports br WHERE TRIM(br.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text)`);
  }
  const ticketsWhere = ticketConditions.join(" AND ");

  const partsConditions = [...partsFilterConditions(filters, pusher), ...buildPartsTokenConditions(tokens, pusher)];
  const partsWhere = partsConditions.join(" AND ");
  const partsKeyExpr = `COALESCE(NULLIF(TRIM(m.dolibarr_ref), ''), 'raw:' || COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier))))`;

  const sql = `
    WITH ${cte}
    SELECT
      (SELECT COUNT(DISTINCT fr.fieldbeat_task_id) FROM filtered_reports fr WHERE ${reportsWhere}) AS reports,
      (SELECT COUNT(DISTINCT fr.client_name) FROM filtered_reports fr WHERE fr.client_name IS NOT NULL AND ${clientsWhere}) AS clients,
      (SELECT COUNT(DISTINCT UPPER(TRIM(equipo))) FROM filtered_reports fr, LATERAL UNNEST(STRING_TO_ARRAY(fr.equipment_internal_ids, '|')) equipo WHERE ${machinesWhere}) AS machines,
      (SELECT COUNT(DISTINCT z.zendesk_ticket_id) FROM processed.zendesk_tickets z WHERE ${ticketsWhere}) AS tickets,
      (SELECT COUNT(DISTINCT ${partsKeyExpr}) FROM marts.used_parts_dolibarr_match m
         LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
         LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
         WHERE ${partsWhere}) AS parts
  `;

  return { sql, params: pusher.params };
}

// --- Consulta de filas por entidad (reutilizada para preview LIMIT 3-5 y para página completa) ---

export function buildEntityRowsQuery(
  entity: Exclude<SearchEntity, "all">,
  filters: SearchFilters,
  tokens: string[],
  reportFieldsAvailable: boolean,
  pusher: ParamPusher,
  limit: number,
  offset: number
): SqlQuery {
  if (entity === "reports") {
    const cte = buildFilteredReportsCte(filters, pusher);
    const where = buildReportsTokenConditions(tokens, pusher, reportFieldsAvailable).join(" AND ");
    const sql = `
      WITH ${cte}
      SELECT fr.fieldbeat_task_id, fr.fieldbeat_task_date, fr.client_name, fr.task_type,
             fr.equipment_internal_ids, fr.linked_zendesk_ticket_id, fr.used_parts_count, fr.description
      FROM filtered_reports fr
      WHERE ${where}
      ORDER BY fr.fieldbeat_task_date DESC, fr.fieldbeat_task_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return { sql, params: pusher.params };
  }

  if (entity === "clients") {
    const cte = buildFilteredReportsCte(filters, pusher);
    const where = buildClientsTokenConditions(tokens, pusher).join(" AND ");
    const sql = `
      WITH ${cte}
      SELECT
        fr.client_name,
        COUNT(DISTINCT fr.fieldbeat_task_id) AS report_count,
        COUNT(DISTINCT NULLIF(TRIM(fr.linked_zendesk_ticket_id), '')) AS ticket_count,
        COUNT(DISTINCT UPPER(TRIM(equipo))) AS machine_count
      FROM filtered_reports fr
      LEFT JOIN LATERAL UNNEST(STRING_TO_ARRAY(fr.equipment_internal_ids, '|')) equipo ON TRUE
      WHERE fr.client_name IS NOT NULL AND ${where}
      GROUP BY fr.client_name
      ORDER BY report_count DESC, fr.client_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return { sql, params: pusher.params };
  }

  if (entity === "machines") {
    const cte = buildFilteredReportsCte(filters, pusher);
    const where = buildMachinesTokenConditions(tokens, pusher).join(" AND ");
    const sql = `
      WITH ${cte}
      SELECT
        UPPER(TRIM(equipo)) AS machine_id,
        COUNT(DISTINCT fr.client_name) AS distinct_client_count,
        MIN(fr.client_name) AS single_client_name,
        COUNT(DISTINCT fr.fieldbeat_task_id) AS report_count,
        COUNT(DISTINCT NULLIF(TRIM(fr.linked_zendesk_ticket_id), '')) AS ticket_count
      FROM filtered_reports fr, LATERAL UNNEST(STRING_TO_ARRAY(fr.equipment_internal_ids, '|')) equipo
      WHERE ${where}
      GROUP BY 1
      ORDER BY report_count DESC, machine_id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return { sql, params: pusher.params };
  }

  if (entity === "tickets") {
    const cte = buildBridgeReportsCte(filters, pusher);
    const conditions = [...ticketDateAndStatusConditions(filters, pusher), ...buildTicketsTokenConditions(tokens, pusher)];
    if (hasTicketBridgeFilters(filters)) {
      conditions.push(`EXISTS (SELECT 1 FROM bridge_reports br WHERE TRIM(br.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text)`);
    }
    const sql = `
      WITH ${cte}
      SELECT
        z.zendesk_ticket_id, z.status, ${TICKET_TITLE_EXPR} AS title, z.created_at,
        COUNT(DISTINCT br.fieldbeat_task_id) AS linked_report_count,
        COUNT(DISTINCT br.client_name) AS distinct_client_count,
        MIN(br.client_name) AS single_client_name
      FROM processed.zendesk_tickets z
      LEFT JOIN bridge_reports br ON TRIM(br.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text
      WHERE ${conditions.join(" AND ")}
      GROUP BY z.zendesk_ticket_id, z.status, z.subject, z.raw_subject, z.created_at
      ORDER BY z.created_at DESC, z.zendesk_ticket_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return { sql, params: pusher.params };
  }

  // parts - GROUP BY únicamente por la clave normalizada (no por
  // dolibarr_ref/raw_part_identifier crudos) para consolidar de verdad
  // variantes de mayúsculas/espacios bajo una sola fila; todo lo demás en
  // el SELECT va agregado (MAX), igual que el precedente ya establecido en
  // /api/audit/placeholders (MAX(m.raw_part_identifier) al agrupar por
  // UPPER(TRIM(raw_part_identifier))).
  const conditions = [...partsFilterConditions(filters, pusher), ...buildPartsTokenConditions(tokens, pusher)];
  const partsKeyExpr = `COALESCE(NULLIF(TRIM(m.dolibarr_ref), ''), 'raw:' || COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier))))`;
  const sql = `
    SELECT
      MAX(m.dolibarr_ref) AS dolibarr_ref,
      COALESCE(MAX(m.dolibarr_label), MAX(m.part_name)) AS part_name,
      MAX(m.raw_part_identifier) AS raw_part_identifier,
      MAX(COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier)))) AS normalized_identifier,
      SUM(COALESCE(p.quantity, 1)) AS quantity_consumed,
      COUNT(DISTINCT m.fieldbeat_task_id) AS report_count,
      COUNT(DISTINCT r.client_name) AS client_count
    FROM marts.used_parts_dolibarr_match m
    LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
    LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY ${partsKeyExpr}
    ORDER BY quantity_consumed DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { sql, params: pusher.params };
}

// --- Mapeo de filas crudas a los contratos tipados, con normalización numérica ---

export function mapReportRow(row: Record<string, unknown>): SearchReportResult {
  const usedPartsCount = toSafeCount(row.used_parts_count);
  const description = typeof row.description === "string" ? row.description : null;
  return {
    key: String(row.fieldbeat_task_id),
    fieldbeatTaskId: String(row.fieldbeat_task_id),
    date: (row.fieldbeat_task_date as string | null) ?? null,
    clientName: (row.client_name as string | null) ?? null,
    machineId: (row.equipment_internal_ids as string | null) ?? null,
    taskType: (row.task_type as string | null) ?? null,
    ticketId: (row.linked_zendesk_ticket_id as string | null) || null,
    snippet: description ? description.slice(0, 160) : null,
    hasParts: usedPartsCount > 0
  };
}

export function mapClientRow(row: Record<string, unknown>): { key: string; clientName: string; reportCount: number; ticketCount: number; machineCount: number } {
  return {
    key: String(row.client_name),
    clientName: String(row.client_name),
    reportCount: toSafeCount(row.report_count),
    ticketCount: toSafeCount(row.ticket_count),
    machineCount: toSafeCount(row.machine_count)
  };
}

function resolveClientNameFallback(distinctCount: unknown, singleName: unknown): string | null {
  const count = toSafeCount(distinctCount);
  if (count === 0) return null;
  if (count > 1) return "Varios clientes";
  return (singleName as string | null) ?? null;
}

export function mapMachineRow(row: Record<string, unknown>): { key: string; machineId: string; clientName: string | null; reportCount: number; ticketCount: number } {
  return {
    key: String(row.machine_id),
    machineId: String(row.machine_id),
    clientName: resolveClientNameFallback(row.distinct_client_count, row.single_client_name),
    reportCount: toSafeCount(row.report_count),
    ticketCount: toSafeCount(row.ticket_count)
  };
}

export function mapTicketRow(row: Record<string, unknown>): SearchTicketResult {
  return {
    key: String(row.zendesk_ticket_id),
    ticketId: String(row.zendesk_ticket_id),
    status: (row.status as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    clientName: resolveClientNameFallback(row.distinct_client_count, row.single_client_name),
    linkedReportCount: toSafeCount(row.linked_report_count),
    date: (row.created_at as string | null) ?? null
  };
}

export function mapPartRow(row: Record<string, unknown>): SearchPartResult {
  const dolibarrRef = (row.dolibarr_ref as string | null) || null;
  const rawIdentifier = (row.raw_part_identifier as string | null) || null;
  const normalizedIdentifier = (row.normalized_identifier as string | null) || null;
  // La clave usa el identificador YA NORMALIZADO (misma expresión que el
  // GROUP BY), nunca el valor crudo de exhibición (rawIdentifier) - así el
  // detail (que recibe esta key de vuelta) compara contra el mismo valor
  // normalizado con el que se agrupó, sin depender de mayúsculas/espacios
  // arbitrarios de la fila elegida por MAX().
  const key = dolibarrRef ? `sku:${dolibarrRef}` : `raw:${normalizedIdentifier ?? ""}`;
  return {
    key,
    sku: dolibarrRef,
    partName: (row.part_name as string | null) ?? null,
    rawIdentifier,
    quantityConsumed: toSafeQuantity(row.quantity_consumed),
    reportCount: toSafeCount(row.report_count),
    clientCount: toSafeCount(row.client_count)
  };
}

// =====================================================================
// Detail (/api/search/detail) - máximo 2 consultas reales por entidad:
// (1) summary global (sin los filtros de la búsqueda activa - ver plan
//     §12.1 "detalle global honestamente rotulado"); (2) 1 sola consulta
// con agregación JSON (json_agg + LIMIT explícito por colección) para
// TODAS las listas relacionadas de esa entidad.
// =====================================================================

const DIGITS_ONLY = /^\d+$/;

/** Valida SOLO el formato de un ID numérico (fieldbeatTaskId/ticketId) - nunca Number()/parseInt(). */
export function assertNumericIdFormat(key: string, label: string): void {
  if (!DIGITS_ONLY.test(key)) {
    throw new Error(`${label} inválido: se esperaba una cadena de dígitos, se recibió "${key}".`);
  }
}

export interface PartsKey {
  type: "sku" | "raw";
  value: string;
}

/** Interpreta el prefijo sku:/raw: de la clave de repuesto - nunca interpola el valor como identificador SQL. */
export function parsePartsKey(key: string): PartsKey {
  if (key.startsWith("sku:")) return { type: "sku", value: key.slice(4) };
  if (key.startsWith("raw:")) return { type: "raw", value: key.slice(4) };
  throw new Error(`Clave de repuesto con formato inválido: "${key}" (se esperaba el prefijo sku: o raw:).`);
}

export function buildClientDetailSummaryQuery(clientName: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(clientName);
  const sql = `
    SELECT
      m.client_name,
      COUNT(DISTINCT m.fieldbeat_task_id) AS report_count,
      COUNT(DISTINCT NULLIF(TRIM(m.linked_zendesk_ticket_id), '')) AS ticket_count,
      COUNT(DISTINCT UPPER(TRIM(equipo))) AS machine_count
    FROM marts.fieldbeat_report_dolibarr_operational_view m
    LEFT JOIN LATERAL UNNEST(STRING_TO_ARRAY(m.equipment_internal_ids, '|')) equipo ON TRUE
    WHERE m.client_name = ${p}
    GROUP BY m.client_name
  `;
  return { sql, params: pusher.params };
}

export function buildClientDetailRelatedQuery(clientName: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(clientName);
  const sql = `
    SELECT
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT fieldbeat_task_id, fieldbeat_task_date, task_type, equipment_internal_ids, linked_zendesk_ticket_id, used_parts_count
         FROM marts.fieldbeat_report_dolibarr_operational_view
         WHERE client_name = ${p}
         ORDER BY fieldbeat_task_date DESC LIMIT 10
       ) x) AS recent_reports,
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT UPPER(TRIM(equipo)) AS machine_id, COUNT(*) AS report_count,
                COUNT(DISTINCT NULLIF(TRIM(linked_zendesk_ticket_id), '')) AS ticket_count
         FROM marts.fieldbeat_report_dolibarr_operational_view, LATERAL UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')) equipo
         WHERE client_name = ${p}
         GROUP BY 1 ORDER BY report_count DESC LIMIT 20
       ) x) AS machines,
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT z.zendesk_ticket_id, z.status, ${TICKET_TITLE_EXPR} AS title, z.created_at,
                (SELECT COUNT(DISTINCT fieldbeat_task_id) FROM marts.fieldbeat_report_dolibarr_operational_view WHERE TRIM(linked_zendesk_ticket_id) = z.zendesk_ticket_id::text) AS linked_report_count
         FROM processed.zendesk_tickets z
         WHERE EXISTS (SELECT 1 FROM marts.fieldbeat_report_dolibarr_operational_view m WHERE m.client_name = ${p} AND TRIM(m.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text)
         ORDER BY z.created_at DESC LIMIT 10
       ) x) AS tickets
  `;
  return { sql, params: pusher.params };
}

export function buildMachineDetailSummaryQuery(machineId: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(machineId);
  const sql = `
    SELECT
      UPPER(TRIM(equipo)) AS machine_id,
      COUNT(DISTINCT client_name) AS distinct_client_count,
      MIN(client_name) AS single_client_name,
      COUNT(DISTINCT fieldbeat_task_id) AS report_count,
      COUNT(DISTINCT NULLIF(TRIM(linked_zendesk_ticket_id), '')) AS ticket_count
    FROM marts.fieldbeat_report_dolibarr_operational_view, LATERAL UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')) equipo
    WHERE UPPER(TRIM(equipo)) = UPPER(TRIM(${p}))
    GROUP BY 1
  `;
  return { sql, params: pusher.params };
}

export function buildMachineDetailRelatedQuery(machineId: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(machineId);
  const sql = `
    SELECT (SELECT COALESCE(json_agg(x), '[]') FROM (
      SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, linked_zendesk_ticket_id, used_parts_count
      FROM marts.fieldbeat_report_dolibarr_operational_view, LATERAL UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')) equipo
      WHERE UPPER(TRIM(equipo)) = UPPER(TRIM(${p}))
      ORDER BY fieldbeat_task_date DESC LIMIT 15
    ) x) AS recent_reports
  `;
  return { sql, params: pusher.params };
}

export function buildReportDetailSummaryQuery(fieldbeatTaskId: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(fieldbeatTaskId);
  const sql = `
    SELECT m.fieldbeat_task_id, m.fieldbeat_task_date, m.client_name, m.task_type,
           m.equipment_internal_ids, m.linked_zendesk_ticket_id, m.used_parts_count, t.description
    FROM marts.fieldbeat_report_dolibarr_operational_view m
    JOIN processed.fieldbeat_tasks t ON m.fieldbeat_task_id = t.fieldbeat_task_id
    WHERE m.fieldbeat_task_id::text = ${p}
  `;
  return { sql, params: pusher.params };
}

export function buildReportDetailRelatedQuery(fieldbeatTaskId: string, reportFieldsAvailable: boolean): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(fieldbeatTaskId);
  const fieldsSubquery = reportFieldsAvailable
    ? `(SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT field_name, field_value FROM processed.fieldbeat_report_fields
         WHERE fieldbeat_task_id::text = ${p} ORDER BY field_index LIMIT 30
       ) x)`
    : `'[]'::json`;
  const sql = `
    SELECT
      ${fieldsSubquery} AS fields,
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT m.dolibarr_ref, COALESCE(m.dolibarr_label, m.part_name) AS part_name, m.raw_part_identifier, p.quantity
         FROM marts.used_parts_dolibarr_match m
         LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
         WHERE m.fieldbeat_task_id::text = ${p} LIMIT 20
       ) x) AS parts
  `;
  return { sql, params: pusher.params };
}

export function buildTicketDetailSummaryQuery(zendeskTicketId: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(zendeskTicketId);
  const sql = `
    SELECT
      z.zendesk_ticket_id, z.status, ${TICKET_TITLE_EXPR} AS title, z.created_at,
      COUNT(DISTINCT r.fieldbeat_task_id) AS linked_report_count,
      COUNT(DISTINCT r.client_name) AS distinct_client_count,
      MIN(r.client_name) AS single_client_name
    FROM processed.zendesk_tickets z
    LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON TRIM(r.linked_zendesk_ticket_id) = z.zendesk_ticket_id::text
    WHERE z.zendesk_ticket_id::text = ${p}
    GROUP BY z.zendesk_ticket_id, z.status, z.subject, z.raw_subject, z.created_at
  `;
  return { sql, params: pusher.params };
}

export function buildTicketDetailRelatedQuery(zendeskTicketId: string): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(zendeskTicketId);
  const sql = `
    SELECT (SELECT COALESCE(json_agg(x), '[]') FROM (
      SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, task_type, equipment_internal_ids
      FROM marts.fieldbeat_report_dolibarr_operational_view
      WHERE TRIM(linked_zendesk_ticket_id) = ${p}
      ORDER BY fieldbeat_task_date DESC LIMIT 15
    ) x) AS linked_reports
  `;
  return { sql, params: pusher.params };
}

export function buildPartDetailSummaryQuery(partsKey: PartsKey): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(partsKey.value);
  const whereClause = partsKey.type === "sku" ? `m.dolibarr_ref = ${p}` : `COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier))) = UPPER(${p})`;
  const sql = `
    SELECT
      MAX(m.dolibarr_ref) AS dolibarr_ref,
      COALESCE(MAX(m.dolibarr_label), MAX(m.part_name)) AS part_name,
      MAX(m.raw_part_identifier) AS raw_part_identifier,
      SUM(COALESCE(p.quantity, 1)) AS quantity_consumed,
      COUNT(DISTINCT m.fieldbeat_task_id) AS report_count,
      COUNT(DISTINCT r.client_name) AS client_count
    FROM marts.used_parts_dolibarr_match m
    LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
    LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
    WHERE ${whereClause}
  `;
  return { sql, params: pusher.params };
}

export function buildPartDetailRelatedQuery(partsKey: PartsKey): SqlQuery {
  const pusher = createParamPusher();
  const p = pusher.push(partsKey.value);
  const whereClause = partsKey.type === "sku" ? `m.dolibarr_ref = ${p}` : `COALESCE(m.normalized_part_identifier, UPPER(TRIM(m.raw_part_identifier))) = UPPER(${p})`;
  const sql = `
    SELECT (SELECT COALESCE(json_agg(x), '[]') FROM (
      SELECT m.fieldbeat_task_id, r.fieldbeat_task_date, r.client_name, p.quantity
      FROM marts.used_parts_dolibarr_match m
      LEFT JOIN processed.fieldbeat_used_parts p ON m.used_part_id = p.used_part_id
      LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON m.fieldbeat_task_id = r.fieldbeat_task_id
      WHERE ${whereClause}
      ORDER BY r.fieldbeat_task_date DESC NULLS LAST LIMIT 15
    ) x) AS recent_usages
  `;
  return { sql, params: pusher.params };
}
