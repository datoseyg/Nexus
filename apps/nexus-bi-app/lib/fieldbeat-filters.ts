import { buildMartDateConditions, buildPeriodGroupExpr, type Grain, type ParamPusher } from "./dashboard-filters";

export type { Grain };
export { buildPeriodGroupExpr };

// ETAPA 6 - filtros de /dashboard/fieldbeat. Deliberadamente NO reutiliza
// DashboardFilters de lib/dashboard-filters.ts como tipo propio (vocabulario
// distinto: FieldBeat necesita equipo/origen/conTicket/conRepuesto, que
// Operacional no tiene, y no necesita sku/bodega/estadoTicket/
// reportQuality, que sí tiene Operacional) - pero SÍ reutiliza sus
// funciones genéricas (buildMartDateConditions, buildPeriodGroupExpr,
// createParamPusher) porque operan sobre la MISMA tabla
// (marts.fieldbeat_report_dolibarr_operational_view) con la misma columna
// de fecha. Ver diagnóstico previo: esa tabla ya tiene client_name/
// task_type/equipment_internal_ids/linked_zendesk_ticket_id/
// used_parts_count a nivel de fila, 3.747 filas = 1:1 con
// processed.fieldbeat_tasks.
export type FieldbeatOrigen = "APK" | "WEB";

const VALID_ORIGENES: readonly FieldbeatOrigen[] = ["APK", "WEB"];

export interface FieldbeatFilters {
  from?: string; // "YYYY-MM-DD"
  to?: string; // "YYYY-MM-DD"
  grain: Grain;
  cliente?: string;
  equipo?: string;
  tipoTarea?: string;
  // created_in real de processed.fieldbeat_tasks (APK/WEB) - NUNCA la
  // heurística "Apoteca/General" de operacional (equipment_internal_ids
  // ILIKE '%APOTECA%'), que mide otra cosa (tipo de cliente, no canal de
  // captura) y no es necesaria acá.
  origen?: FieldbeatOrigen;
  // Tri-estado explícito: undefined = todos, true = con, false = sin.
  conTicket?: boolean;
  conRepuesto?: boolean;
}

export type FieldbeatFilterKey = "cliente" | "equipo" | "tipoTarea" | "origen" | "conTicket" | "conRepuesto";

const VALID_GRAINS: readonly Grain[] = ["day", "week", "month"];

function parseTriState(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function parseFieldbeatFilters(searchParams: URLSearchParams): FieldbeatFilters {
  const grainParam = searchParams.get("grain") ?? "";
  const origenParam = searchParams.get("origen") ?? "";
  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    grain: (VALID_GRAINS as readonly string[]).includes(grainParam) ? (grainParam as Grain) : "month",
    cliente: searchParams.get("cliente") || undefined,
    equipo: searchParams.get("equipo") || undefined,
    tipoTarea: searchParams.get("tipoTarea") || undefined,
    origen: (VALID_ORIGENES as readonly string[]).includes(origenParam) ? (origenParam as FieldbeatOrigen) : undefined,
    conTicket: parseTriState(searchParams.get("conTicket")),
    conRepuesto: parseTriState(searchParams.get("conRepuesto"))
  };
}

function col(alias: string, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

// Condiciones sobre columnas nativas de
// marts.fieldbeat_report_dolibarr_operational_view. `exclude` implementa
// self-exclusion de cross-filter (mismo criterio que
// buildMartIdentityConditions en lib/dashboard-filters.ts): el bloque que
// originó un filtro no se lo aplica a sí mismo.
export function buildFieldbeatMartConditions(filters: FieldbeatFilters, alias: string, pusher: ParamPusher, exclude: FieldbeatFilterKey[] = []): string[] {
  const skip = new Set(exclude);
  const conditions: string[] = [...buildMartDateConditions(filters, alias, pusher)];

  if (filters.cliente && !skip.has("cliente")) {
    conditions.push(`${col(alias, "client_name")} = ${pusher.push(filters.cliente)}`);
  }
  if (filters.tipoTarea && !skip.has("tipoTarea")) {
    conditions.push(`${col(alias, "task_type")} = ${pusher.push(filters.tipoTarea)}`);
  }
  if (filters.equipo && !skip.has("equipo")) {
    conditions.push(`${col(alias, "equipment_internal_ids")} ILIKE ${pusher.push(`%${filters.equipo}%`)}`);
  }
  if (filters.conTicket !== undefined && !skip.has("conTicket")) {
    conditions.push(filters.conTicket ? `${col(alias, "linked_zendesk_ticket_id")} IS NOT NULL` : `${col(alias, "linked_zendesk_ticket_id")} IS NULL`);
  }
  if (filters.conRepuesto !== undefined && !skip.has("conRepuesto")) {
    conditions.push(filters.conRepuesto ? `${col(alias, "used_parts_count")} > 0` : `${col(alias, "used_parts_count")} = 0`);
  }

  return conditions;
}

// origen (created_in) vive en processed.fieldbeat_tasks, no en la mart -
// subquery, mismo patrón que buildUsedPartsFilterSubquery en
// lib/dashboard-filters.ts.
export function buildFieldbeatOrigenSubquery(filters: FieldbeatFilters, martAlias: string, pusher: ParamPusher, exclude: FieldbeatFilterKey[] = []): string | null {
  if (!filters.origen || exclude.includes("origen")) return null;
  return `${col(martAlias, "fieldbeat_task_id")} IN (SELECT fieldbeat_task_id FROM processed.fieldbeat_tasks WHERE created_in = ${pusher.push(filters.origen)})`;
}
