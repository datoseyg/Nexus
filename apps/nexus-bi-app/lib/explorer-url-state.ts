// Estado de URL del Explorador semántico - misma familia que
// lib/audit-manual-review-url-state.ts/lib/audit-bandeja-url-state.ts
// (useSearchParams + router.push, nunca useState local no persistido):
// entidad activa, página, búsqueda y filtros estructurados sobreviven a un
// refresh y son compartibles por link. Pure functions, sin DOM - testeables
// sin jsdom.
import type { ExplorerEntity } from "@/types/explorer";

export const EXPLORER_ENTITIES: ExplorerEntity[] = ["clients", "equipment", "technicians", "reports", "tickets", "parts", "products", "contracts", "issues"];
export const DEFAULT_EXPLORER_ENTITY: ExplorerEntity = "reports";

// Claves de filtro reales conocidas - cada entidad solo lee/renderiza las
// suyas (ver lib/explorer-filters-config.ts), pero se declaran juntas acá
// para que la URL tenga una forma fija y predecible entre entidades.
export interface ExplorerFilters {
  client?: string;
  taskType?: string;
  dateFrom?: string;
  dateTo?: string;
  severity?: string;
  status?: string;
  entityType?: string;
}

export const EXPLORER_FILTER_KEYS: Array<keyof ExplorerFilters> = ["client", "taskType", "dateFrom", "dateTo", "severity", "status", "entityType"];

export interface ExplorerUrlState {
  entity: ExplorerEntity;
  page: number;
  q: string;
  filters: ExplorerFilters;
}

/** Un valor de entidad inválido o ausente siempre resuelve a la entidad
 * por defecto (Reportes - ya tiene precedente maduro en Búsqueda). */
export function readExplorerUrlState(params: URLSearchParams): ExplorerUrlState {
  const rawEntity = params.get("entity");
  const entity = rawEntity && EXPLORER_ENTITIES.includes(rawEntity as ExplorerEntity) ? (rawEntity as ExplorerEntity) : DEFAULT_EXPLORER_ENTITY;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = params.get("q")?.trim() ?? "";
  const filters: ExplorerFilters = {};
  for (const key of EXPLORER_FILTER_KEYS) {
    const v = params.get(key)?.trim();
    if (v) filters[key] = v;
  }
  return { entity, page, q, filters };
}

/** Nunca escribe page=1/q vacío/filtros vacíos en la URL (son los defaults). */
export function buildExplorerQueryString(state: ExplorerUrlState): string {
  const params = new URLSearchParams();
  if (state.entity !== DEFAULT_EXPLORER_ENTITY) params.set("entity", state.entity);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q) params.set("q", state.q);
  for (const key of EXPLORER_FILTER_KEYS) {
    const v = state.filters[key];
    if (v) params.set(key, v);
  }
  return params.toString();
}

export function hasActiveExplorerFilters(state: Pick<ExplorerUrlState, "q" | "filters">): boolean {
  return Boolean(state.q) || EXPLORER_FILTER_KEYS.some(key => Boolean(state.filters[key]));
}
