import type { DuckDBValue } from "@duckdb/node-api";
import { ESTADO_GENERAL_REVERSE, TICKET_ESTADO_GROUPS } from "./dashboard-sql";

// Filtros globales del Dashboard Operacional (ambos tabs). Viajan en la URL
// (?from=&to=&grain=&cliente=&...) para que el estado sea compartible — ver
// docs/DASHBOARD_VISUAL_STYLE.md § "Filtros globales y cross-filter".
export type Grain = "day" | "week" | "month";

export interface DashboardFilters {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  grain: Grain;
  cliente?: string;
  tipoTarea?: string;
  maquina?: string;
  sku?: string;
  bodega?: string;
  estadoTicket?: string; // "Cerrado" | "Abierto" | "Pendiente"
  origenRegistro?: string; // "General" | "Apoteca"
  reportQuality?: string; // etiqueta de ESTADO_GENERAL_LABELS, ej. "Validación Manual"
}

export type FilterKey =
  | "cliente"
  | "tipoTarea"
  | "maquina"
  | "sku"
  | "bodega"
  | "estadoTicket"
  | "origenRegistro"
  | "reportQuality";

const VALID_GRAINS: Grain[] = ["day", "week", "month"];

export function parseDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
  const grainParam = searchParams.get("grain") ?? "";
  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    grain: (VALID_GRAINS as string[]).includes(grainParam) ? (grainParam as Grain) : "month",
    cliente: searchParams.get("cliente") || undefined,
    tipoTarea: searchParams.get("tipoTarea") || undefined,
    maquina: searchParams.get("maquina") || undefined,
    sku: searchParams.get("sku") || undefined,
    bodega: searchParams.get("bodega") || undefined,
    estadoTicket: searchParams.get("estadoTicket") || undefined,
    origenRegistro: searchParams.get("origenRegistro") || undefined,
    reportQuality: searchParams.get("reportQuality") || undefined
  };
}

// Un query completo comparte un único Pusher para que todos los $N
// numerados de sus distintas condiciones (fechas, cliente, sku, bodega...)
// no choquen entre sí.
export interface ParamPusher {
  params: DuckDBValue[];
  push: (value: DuckDBValue) => string;
}

export function createParamPusher(): ParamPusher {
  const params: DuckDBValue[] = [];
  return {
    params,
    push(value: DuckDBValue): string {
      params.push(value);
      return `$${params.length}`;
    }
  };
}

function col(alias: string, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

// Rango de fechas sobre marts.fieldbeat_report_dolibarr_operational_view.fieldbeat_task_date
// (universo report-céntrico) — ver docs/DASHBOARD_VISUAL_STYLE.md.
export function buildMartDateConditions(filters: DashboardFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];
  if (filters.from) conditions.push(`CAST(${col(alias, "fieldbeat_task_date")} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(${col(alias, "fieldbeat_task_date")} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  return conditions;
}

// Rango de fechas sobre processed.zendesk_tickets.created_at (universo
// ticket-céntrico) — se usa por defecto created_at, no updated_at, y queda
// documentado en docs/DASHBOARD_VISUAL_STYLE.md.
export function buildZendeskDateConditions(filters: DashboardFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];
  if (filters.from) conditions.push(`CAST(${col(alias, "created_at")} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(${col(alias, "created_at")} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  return conditions;
}

// Condiciones "de identidad" sobre columnas nativas de
// marts.fieldbeat_report_dolibarr_operational_view — cliente, tipo de
// tarea, máquina, origen de registro (heurística Apoteca/General) y
// estado general (report_quality_status remapeado). `exclude` implementa
// el self-exclusion del cross-filter: el gráfico que originó un filtro no
// debe aplicárselo a sí mismo (para no colapsar su propia distribución).
export function buildMartIdentityConditions(
  filters: DashboardFilters,
  alias: string,
  pusher: ParamPusher,
  exclude: FilterKey[] = []
): string[] {
  const skip = new Set(exclude);
  const conditions: string[] = [];

  if (filters.cliente && !skip.has("cliente")) {
    conditions.push(`${col(alias, "client_name")} = ${pusher.push(filters.cliente)}`);
  }
  if (filters.tipoTarea && !skip.has("tipoTarea")) {
    conditions.push(`${col(alias, "task_type")} = ${pusher.push(filters.tipoTarea)}`);
  }
  if (filters.maquina && !skip.has("maquina")) {
    conditions.push(`${col(alias, "equipment_internal_ids")} ILIKE ${pusher.push(`%${filters.maquina}%`)}`);
  }
  if (filters.origenRegistro && !skip.has("origenRegistro")) {
    const expr = `UPPER(COALESCE(${col(alias, "equipment_internal_ids")}, ''))`;
    if (filters.origenRegistro === "Apoteca") conditions.push(`${expr} LIKE '%APOTECA%'`);
    else if (filters.origenRegistro === "General") conditions.push(`${expr} NOT LIKE '%APOTECA%'`);
  }
  if (filters.reportQuality && !skip.has("reportQuality")) {
    const rawStatuses = ESTADO_GENERAL_REVERSE[filters.reportQuality] ?? [];
    if (rawStatuses.length > 0) {
      const placeholders = rawStatuses.map(status => pusher.push(status)).join(", ");
      conditions.push(`${col(alias, "report_quality_status")} IN (${placeholders})`);
    }
  }

  return conditions;
}

// sku/bodega viven en processed.fieldbeat_used_parts, tabla distinta de la
// mart — se aplican como subquery `fieldbeat_task_id IN (...)` cuando la
// query base no está ya unida a esa tabla.
export function buildUsedPartsFilterSubquery(
  filters: DashboardFilters,
  martAlias: string,
  pusher: ParamPusher,
  exclude: FilterKey[] = []
): string | null {
  const skip = new Set(exclude);
  const sub: string[] = [];

  if (filters.sku && !skip.has("sku")) {
    const placeholder = pusher.push(`%${filters.sku}%`);
    sub.push(`(part_number ILIKE ${placeholder} OR dolibarr_ref ILIKE ${placeholder})`);
  }
  if (filters.bodega && !skip.has("bodega")) {
    sub.push(`origin_location ILIKE ${pusher.push(`%${filters.bodega}%`)}`);
  }

  if (sub.length === 0) return null;
  return `${col(martAlias, "fieldbeat_task_id")} IN (SELECT fieldbeat_task_id FROM processed.fieldbeat_used_parts WHERE ${sub.join(" AND ")})`;
}

// Inverso de buildUsedPartsFilterSubquery: aplica los filtros "de
// identidad" del universo report-céntrico (cliente/tipoTarea/maquina/
// origenRegistro/reportQuality) a una query que parte de
// processed.fieldbeat_used_parts o marts.used_parts_dolibarr_match (alias
// sin prefijo, ya que se evalúa dentro de un subquery sobre la mart).
export function buildMartFilterSubquery(
  filters: DashboardFilters,
  usedPartsAlias: string,
  pusher: ParamPusher,
  exclude: FilterKey[] = []
): string | null {
  const conditions = buildMartIdentityConditions(filters, "", pusher, exclude);
  const dateConditions = buildMartDateConditions(filters, "", pusher);
  const all = [...conditions, ...dateConditions];
  if (all.length === 0) return null;
  return `${col(usedPartsAlias, "fieldbeat_task_id")} IN (SELECT fieldbeat_task_id FROM marts.fieldbeat_report_dolibarr_operational_view WHERE ${all.join(" AND ")})`;
}

// Distribución de estados de TICKETS Zendesk (closed/solved -> Cerrado,
// open/new -> Abierto, resto -> Pendiente) — ver docs/DASHBOARD_VISUAL_STYLE.md.
// Nunca usar processed.fieldbeat_tasks.state / mart.task_state para esto.
export function ticketEstadoCaseExpr(column: string): string {
  const cerrado = TICKET_ESTADO_GROUPS.Cerrado.map(s => `'${s}'`).join(", ");
  const abierto = TICKET_ESTADO_GROUPS.Abierto.map(s => `'${s}'`).join(", ");
  return `CASE WHEN LOWER(${column}) IN (${cerrado}) THEN 'Cerrado' WHEN LOWER(${column}) IN (${abierto}) THEN 'Abierto' ELSE 'Pendiente' END`;
}

// Condiciones sobre processed.zendesk_tickets: rango de fechas (created_at)
// + estado de ticket directo, más un puente opcional hacia
// marts.fieldbeat_report_dolibarr_operational_view cuando hay filtros de
// cliente/tipoTarea/maquina/origenRegistro/reportQuality activos (solo
// afecta a los tickets que sí están vinculados a un reporte FieldBeat —
// ver limitación documentada en DASHBOARD_VISUAL_STYLE.md).
export function buildZendeskConditions(
  filters: DashboardFilters,
  alias: string,
  pusher: ParamPusher,
  exclude: FilterKey[] = []
): string[] {
  const skip = new Set(exclude);
  const conditions: string[] = [...buildZendeskDateConditions(filters, alias, pusher)];

  if (filters.estadoTicket && !skip.has("estadoTicket")) {
    const statusCol = col(alias, "status");
    if (filters.estadoTicket === "Cerrado") conditions.push(`LOWER(${statusCol}) IN ('closed', 'solved')`);
    else if (filters.estadoTicket === "Abierto") conditions.push(`LOWER(${statusCol}) IN ('open', 'new')`);
    else if (filters.estadoTicket === "Pendiente") conditions.push(`LOWER(${statusCol}) NOT IN ('closed', 'solved', 'open', 'new')`);
  }

  const bridgeConditions = buildMartIdentityConditions(filters, "", pusher, exclude);
  if (bridgeConditions.length > 0) {
    conditions.push(
      `${col(alias, "zendesk_ticket_id")} IN (SELECT CAST(linked_zendesk_ticket_id AS BIGINT) FROM marts.fieldbeat_report_dolibarr_operational_view WHERE linked_zendesk_ticket_id IS NOT NULL AND ${bridgeConditions.join(" AND ")})`
    );
  }

  return conditions;
}

// Refs de repuesto que no aportan valor de negocio (texto libre tipo
// "sin número", "no hay", etc.) — defensa adicional; en la práctica
// marts.used_parts_dolibarr_match.match_status = 'MATCHED' ya excluye estos
// valores (los rechaza el resolver como PLACEHOLDER_VALUE antes de llegar
// acá), pero se valida explícitamente para no depender solo de eso.
export const JUNK_DOLIBARR_REFS = [
  "N/A",
  "NA",
  "--",
  "-",
  "...",
  "NO HAY",
  "S/N",
  "SN",
  "SIN NUMERO",
  "SIN NÚMERO",
  "NULL"
];

export function buildPeriodGroupExpr(column: string, grain: Grain): string {
  if (grain === "day") return `STRFTIME(${column}, '%Y-%m-%d')`;
  if (grain === "week") return `STRFTIME(DATE_TRUNC('week', ${column}), '%Y-%m-%d')`;
  return `STRFTIME(${column}, '%Y-%m')`;
}
