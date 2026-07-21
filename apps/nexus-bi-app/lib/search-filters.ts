import { clampPage, clampPageSize } from "./sql-guardrails";
import type { ConRepuestoFilter, SearchEntity } from "@/types/search";

export const MAX_FILTER_VALUE_LENGTH = 200;

const SEARCH_ENTITIES: readonly SearchEntity[] = ["all", "reports", "tickets", "clients", "machines", "parts"];
const CON_REPUESTO_VALUES: readonly ConRepuestoFilter[] = ["all", "yes", "no"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export class SearchValidationError extends Error {}

export interface SearchFilters {
  /** Consulta cruda (solo trim), sin normalizar todavía - ver lib/search-query-normalizer.ts. */
  q: string;
  entity: SearchEntity;
  from?: string;
  to?: string;
  cliente?: string;
  maquina?: string;
  tipoTarea?: string;
  estadoTicket?: string;
  conRepuesto: ConRepuestoFilter;
  page: number;
  pageSize: number;
}

function isSearchEntity(value: string): value is SearchEntity {
  return (SEARCH_ENTITIES as readonly string[]).includes(value);
}

function isConRepuestoFilter(value: string): value is ConRepuestoFilter {
  return (CON_REPUESTO_VALUES as readonly string[]).includes(value);
}

function parseOptionalString(value: string | null, label: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_FILTER_VALUE_LENGTH) {
    throw new SearchValidationError(`El filtro "${label}" excede la longitud máxima permitida (${MAX_FILTER_VALUE_LENGTH} caracteres).`);
  }
  return trimmed;
}

function parseDate(value: string | null, label: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!DATE_FORMAT.test(trimmed)) {
    throw new SearchValidationError(`El parámetro "${label}" debe tener formato YYYY-MM-DD.`);
  }
  return trimmed;
}

/**
 * Valida y normaliza los parámetros de /api/search, /api/search/filters no
 * los necesita. Lanza SearchValidationError (400) ante cualquier valor con
 * forma inválida - nunca asume un default silencioso para un valor
 * explícitamente mal formado.
 */
export function parseSearchFilters(searchParams: URLSearchParams): SearchFilters {
  const rawEntity = searchParams.get("entity")?.trim() || "all";
  if (!isSearchEntity(rawEntity)) {
    throw new SearchValidationError(`entity inválida: "${rawEntity}". Valores permitidos: ${SEARCH_ENTITIES.join(", ")}.`);
  }

  const rawConRepuesto = searchParams.get("conRepuesto")?.trim() || "all";
  if (!isConRepuestoFilter(rawConRepuesto)) {
    throw new SearchValidationError(`conRepuesto inválido: "${rawConRepuesto}". Valores permitidos: ${CON_REPUESTO_VALUES.join(", ")}.`);
  }

  const from = parseDate(searchParams.get("from"), "from");
  const to = parseDate(searchParams.get("to"), "to");
  if (from && to && from > to) {
    throw new SearchValidationError("El rango de fechas es inválido: 'from' es posterior a 'to'.");
  }

  const rawQ = (searchParams.get("q") ?? "").trim();
  if (rawQ.length > 2000) {
    // Límite defensivo muy por encima de MAX_QUERY_LENGTH (200) del
    // normalizador - evita construir un string absurdamente grande antes de
    // siquiera llegar a normalizeSearchQuery().
    throw new SearchValidationError("El parámetro q excede la longitud máxima aceptada.");
  }

  return {
    q: rawQ,
    entity: rawEntity,
    from,
    to,
    cliente: parseOptionalString(searchParams.get("cliente"), "cliente"),
    maquina: parseOptionalString(searchParams.get("maquina"), "maquina"),
    tipoTarea: parseOptionalString(searchParams.get("tipoTarea"), "tipoTarea"),
    estadoTicket: parseOptionalString(searchParams.get("estadoTicket"), "estadoTicket"),
    conRepuesto: rawConRepuesto,
    page: clampPage(Number(searchParams.get("page"))),
    pageSize: clampPageSize(Number(searchParams.get("pageSize")))
  };
}

export function parseDetailParams(searchParams: URLSearchParams): { entity: Exclude<SearchEntity, "all">; key: string } {
  const rawEntity = searchParams.get("entity")?.trim() ?? "";
  if (!rawEntity || rawEntity === "all" || !isSearchEntity(rawEntity)) {
    throw new SearchValidationError(`entity inválida o faltante para el detalle: "${rawEntity}".`);
  }
  const key = searchParams.get("key")?.trim() ?? "";
  if (!key) {
    throw new SearchValidationError("Falta el parámetro key.");
  }
  if (key.length > MAX_FILTER_VALUE_LENGTH) {
    throw new SearchValidationError(`key excede la longitud máxima permitida (${MAX_FILTER_VALUE_LENGTH} caracteres).`);
  }
  return { entity: rawEntity as Exclude<SearchEntity, "all">, key };
}

// ParamPusher propio (no el de lib/dashboard-filters.ts, que sigue tipado
// contra el DuckDBValue heredado de una migración anterior) - tipado contra
// unknown[], compatible con runQuery(sql, params?: unknown[]) de lib/db.ts.
// Cada query construye el suyo propio, nunca se comparte entre dos
// runQuery() distintos (ver plan ETAPA 8 §12.4).
export interface ParamPusher {
  params: unknown[];
  push: (value: unknown) => string;
}

export function createParamPusher(): ParamPusher {
  const params: unknown[] = [];
  return {
    params,
    push(value: unknown): string {
      params.push(value);
      return `$${params.length}`;
    }
  };
}

/**
 * Condiciones de fecha sobre fieldbeat_task_date - mismo criterio que
 * lib/dashboard-filters.ts buildMartDateConditions, reimplementado acá
 * contra el ParamPusher propio de arriba para no acoplarse al tipo
 * DuckDBValue heredado de ese módulo.
 */
export function buildReportDateConditions(filters: Pick<SearchFilters, "from" | "to">, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];
  const col = alias ? `${alias}.fieldbeat_task_date` : "fieldbeat_task_date";
  if (filters.from) conditions.push(`CAST(${col} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(${col} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  return conditions;
}

/** Condiciones de identidad (cliente/máquina/tipoTarea) - mismo criterio que buildMartIdentityConditions. */
export function buildReportIdentityConditions(
  filters: Pick<SearchFilters, "cliente" | "maquina" | "tipoTarea">,
  alias: string,
  pusher: ParamPusher
): string[] {
  const conditions: string[] = [];
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  if (filters.cliente) conditions.push(`${col("client_name")} = ${pusher.push(filters.cliente)}`);
  if (filters.tipoTarea) conditions.push(`${col("task_type")} = ${pusher.push(filters.tipoTarea)}`);
  if (filters.maquina) conditions.push(`${col("equipment_internal_ids")} ILIKE ${pusher.push(`%${filters.maquina}%`)}`);
  return conditions;
}

export function buildConRepuestoCondition(conRepuesto: ConRepuestoFilter, alias: string): string | null {
  const col = alias ? `${alias}.used_parts_count` : "used_parts_count";
  if (conRepuesto === "yes") return `COALESCE(${col}, 0) > 0`;
  if (conRepuesto === "no") return `COALESCE(${col}, 0) = 0`;
  return null;
}
