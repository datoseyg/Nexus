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
// para que la URL tenga una forma fija y predecible entre entidades. Varias
// claves se REUTILIZAN entre entidades cuando el concepto de negocio es
// literalmente el mismo (ej. "client" en reports/equipment/parts/contracts,
// "hasActiveIssues" en las 5 entidades que lo soportan, "matchStatus" con
// vocabularios distintos según la entidad activa) - nunca una clave nueva
// para el mismo concepto repetido.
export interface ExplorerFilters {
  // Reportes (existente) + reutilizado por Equipos/Repuestos/Contratos.
  client?: string;
  taskType?: string;
  dateFrom?: string;
  dateTo?: string;
  // Incidencias (existente).
  severity?: string;
  status?: string;
  entityType?: string;
  detection?: string;
  ruleCode?: string;
  verification?: string;
  // Clientes.
  city?: string;
  commune?: string;
  hasEquipment?: string;
  // Compartido: Clientes/Equipos ("con/sin reportes"), Tickets ("con/sin
  // reporte FieldBeat").
  hasReports?: string;
  // Cross-cutting: Clientes/Equipos/Reportes/Tickets/Repuestos.
  hasActiveIssues?: string;
  // Equipos.
  equipmentType?: string;
  model?: string;
  linkStatus?: string;
  // Compartido: Equipos/Contratos (mismo vocabulario de 8 valores).
  contractStatus?: string;
  // Compartido: Equipos/Contratos (3 valores) y Repuestos (5 valores
  // distintos) - el vocabulario real lo decide la entidad activa.
  matchStatus?: string;
  // Técnicos.
  verified?: string;
  hasPrimaryReports?: string;
  hasParticipantReports?: string;
  // Reportes.
  equipment?: string;
  technician?: string;
  hasTicket?: string;
  hasParts?: string;
  qualityStatus?: string;
  // Tickets.
  ticketStatus?: string;
  // Repuestos.
  hasDolibarrProduct?: string;
  // Productos.
  saleStatus?: string;
  purchaseStatus?: string;
  hasUsageInReports?: string;
  // Contratos.
  spaTier?: string;
  serviceWeekday?: string;
  serviceWeekend?: string;
  partsCoverage?: string;
  warrantyStatus?: string;
}

export const EXPLORER_FILTER_KEYS: Array<keyof ExplorerFilters> = [
  "client",
  "taskType",
  "dateFrom",
  "dateTo",
  "severity",
  "status",
  "entityType",
  "detection",
  "ruleCode",
  "verification",
  "city",
  "commune",
  "hasEquipment",
  "hasReports",
  "hasActiveIssues",
  "equipmentType",
  "model",
  "linkStatus",
  "contractStatus",
  "matchStatus",
  "verified",
  "hasPrimaryReports",
  "hasParticipantReports",
  "equipment",
  "technician",
  "hasTicket",
  "hasParts",
  "qualityStatus",
  "ticketStatus",
  "hasDolibarrProduct",
  "saleStatus",
  "purchaseStatus",
  "hasUsageInReports",
  "spaTier",
  "serviceWeekday",
  "serviceWeekend",
  "partsCoverage",
  "warrantyStatus"
];

export interface ExplorerUrlState {
  entity: ExplorerEntity;
  page: number;
  q: string;
  filters: ExplorerFilters;
  /** Clave del detalle abierto (canónica de la entidad activa) - vive en la
   * URL, nunca solo en useState local, para que "Ver equipo"/"Ver cliente"
   * desde OTRA entidad (ej. el detalle de un Contrato) navegue reemplazando
   * el contenido vía URL canónica en vez de apilar un segundo drawer sobre
   * el primero. Sección 14 del encargo NEXUS V3 After-Hours - Reportes
   * (usesExternalDrawer) reutiliza EL MISMO campo `key` (ver
   * deriveExplorerDrawerKeys más abajo), ya no un useState local aparte -
   * antes eso hacía que un deep-link ?entity=reports&key=<id> se ignorara
   * en silencio. */
  key?: string;
}

/** Sección 14.1/14.6 del encargo NEXUS V3 After-Hours - deriva qué drawer
 * debe abrirse (el genérico ExplorerDetailDrawer vía selectedKey, o el
 * canónico de reportes vía reportDrawerId) a partir del MISMO valor de URL
 * (`key`), gateado únicamente por si la entidad activa usa drawer externo.
 * Función pura extraída de ExplorerShell.tsx para quedar testeable sin
 * useSearchParams/next/navigation (el componente no puede importarse en el
 * runner de tests) - reactivo a atrás/adelante del navegador porque
 * ExplorerShell la vuelve a llamar en cada render con el urlKey vigente,
 * nunca cachea el resultado en un useState. */
export function deriveExplorerDrawerKeys(usesExternalDrawer: boolean, urlKey: string | undefined): { selectedKey: string | null; reportDrawerId: string | null } {
  const activeKey = urlKey ?? null;
  return { selectedKey: usesExternalDrawer ? null : activeKey, reportDrawerId: usesExternalDrawer ? activeKey : null };
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
  const key = params.get("key")?.trim() || undefined;
  return { entity, page, q, filters, key };
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
  if (state.key) params.set("key", state.key);
  return params.toString();
}

export function hasActiveExplorerFilters(state: Pick<ExplorerUrlState, "q" | "filters">): boolean {
  return Boolean(state.q) || EXPLORER_FILTER_KEYS.some(key => Boolean(state.filters[key]));
}
