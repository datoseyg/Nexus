// Estado de URL del nuevo shell de 4 pestañas (Phase 3 §4), siguiendo el
// MISMO idioma que components/search/SearchDashboard.tsx (única pantalla
// de NEXUS con tabs+filtros persistidos en la URL vía useSearchParams +
// router.push, en vez del patrón useState local no persistido de
// DashboardShell/AuditManualReviewShell - ver investigación previa). Pure
// functions, sin DOM - testeables sin jsdom.
import type { FieldbeatQualityFilters } from "./fieldbeat-quality-filters";
import { CROSSING_TYPES, type CrossingType } from "@/types/fieldbeat-crossings";
import {
  REPORTS_SORT_KEYS,
  REPORTS_VIEWS,
  DEFAULT_REPORTS_PAGE_SIZE,
  parseReportsPageSize,
  parseReportsSearch
} from "./fieldbeat-reports-queries";
import type { FieldbeatReportsDirection, FieldbeatReportsSortKey, FieldbeatReportsView } from "@/types/fieldbeat-reports";

export const FIELDBEAT_TABS = ["overview", "quality", "crossings", "reports"] as const;
export type FieldbeatTab = (typeof FIELDBEAT_TABS)[number];
export const DEFAULT_FIELDBEAT_TAB: FieldbeatTab = "overview";

export const EVOLUTION_SERIES = ["completeness", "inconsistencies", "traceability", "equipmentIdentification"] as const;
export type EvolutionSeriesKey = (typeof EVOLUTION_SERIES)[number];
export const DEFAULT_EVOLUTION_SERIES: EvolutionSeriesKey = "inconsistencies";

const VALID_TICKET_STATUSES = ["accessible", "missing_or_restricted", "none"] as const;
const VALID_PART_STATUSES = ["fully_traceable", "contains_placeholder", "contains_no_match", "contains_ambiguous"] as const;
const VALID_SEVERITIES = ["Alta", "Media", "Baja", "Advertencia"] as const;
const VALID_ORIGINS = ["APK", "WEB"] as const;

export const DEFAULT_REPORTS_VIEW: FieldbeatReportsView = "exceptions";
export const DEFAULT_REPORTS_SORT: FieldbeatReportsSortKey = "date";
export const DEFAULT_REPORTS_DIRECTION: FieldbeatReportsDirection = "desc";

export interface FieldbeatUrlState {
  tab: FieldbeatTab;
  filters: FieldbeatQualityFilters;
  crossing: CrossingType;
  evolutionSeries: EvolutionSeriesKey;
  reportsView: FieldbeatReportsView;
  reportsPage: number;
  reportsPageSize: number;
  reportsSort: FieldbeatReportsSortKey;
  reportsDirection: FieldbeatReportsDirection;
  reportsSearch: string | null;
  /** Seña para el futuro drawer de detalle (Phase 5) - se persiste en la
   * URL y se puede seleccionar/deseleccionar (click/Enter/Space en una
   * fila) ya en Phase 4, pero ningún componente renderiza un drawer todavía. */
  selectedReportId: string | null;
}

function str(params: URLSearchParams, key: string): string | undefined {
  const v = params.get(key);
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function enumVal<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = str(params, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Un valor de tab inválido o ausente siempre resuelve a "overview" (Phase 3 §4). */
export function readFieldbeatUrlState(params: URLSearchParams): FieldbeatUrlState {
  const tab = enumVal(params, "tab", FIELDBEAT_TABS) ?? DEFAULT_FIELDBEAT_TAB;
  const crossing = enumVal(params, "crossing", CROSSING_TYPES) ?? CROSSING_TYPES[0];
  const evolutionSeries = enumVal(params, "evolution", EVOLUTION_SERIES) ?? DEFAULT_EVOLUTION_SERIES;
  const reportsView = enumVal(params, "reportsView", REPORTS_VIEWS) ?? DEFAULT_REPORTS_VIEW;
  const reportsPage = Math.max(1, Number(params.get("reportsPage")) || 1);
  const reportsPageSize = parseReportsPageSize(params.get("reportsPageSize"));
  const reportsSort = enumVal(params, "reportsSort", REPORTS_SORT_KEYS) ?? DEFAULT_REPORTS_SORT;
  const reportsDirection = enumVal(params, "reportsDirection", ["asc", "desc"] as const) ?? DEFAULT_REPORTS_DIRECTION;
  const reportsSearch = parseReportsSearch(params.get("reportsSearch"));
  const selectedReportId = parseReportsSearch(params.get("report"));

  const filters: FieldbeatQualityFilters = {
    dateFrom: str(params, "dateFrom"),
    dateTo: str(params, "dateTo"),
    technician: str(params, "technician"),
    client: str(params, "client"),
    equipment: str(params, "equipment"),
    taskType: str(params, "taskType"),
    origin: enumVal(params, "origin", VALID_ORIGINS),
    ticketStatus: enumVal(params, "ticketStatus", VALID_TICKET_STATUSES),
    partStatus: enumVal(params, "partStatus", VALID_PART_STATUSES),
    qualityStatus: str(params, "qualityStatus") as FieldbeatQualityFilters["qualityStatus"],
    inconsistencyCode: str(params, "inconsistencyCode") as FieldbeatQualityFilters["inconsistencyCode"],
    severity: enumVal(params, "severity", VALID_SEVERITIES)
  };

  return {
    tab,
    filters,
    crossing,
    evolutionSeries,
    reportsView,
    reportsPage,
    reportsPageSize,
    reportsSort,
    reportsDirection,
    reportsSearch,
    selectedReportId
  };
}

/** Nunca escribe un valor default en la URL (tab=overview, crossing por
 * defecto, evolution por defecto, reportsPage=1, reportsView=exceptions,
 * reportsPageSize=25, reportsSort=date, reportsDirection=desc quedan
 * omitidos). */
export function buildFieldbeatQueryString(state: FieldbeatUrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== DEFAULT_FIELDBEAT_TAB) params.set("tab", state.tab);

  const f = state.filters;
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  if (f.technician) params.set("technician", f.technician);
  if (f.client) params.set("client", f.client);
  if (f.equipment) params.set("equipment", f.equipment);
  if (f.taskType) params.set("taskType", f.taskType);
  if (f.origin) params.set("origin", f.origin);
  if (f.ticketStatus) params.set("ticketStatus", f.ticketStatus);
  if (f.partStatus) params.set("partStatus", f.partStatus);
  if (f.qualityStatus) params.set("qualityStatus", f.qualityStatus);
  if (f.inconsistencyCode) params.set("inconsistencyCode", f.inconsistencyCode);
  if (f.severity) params.set("severity", f.severity);

  if (state.tab === "crossings" && state.crossing !== CROSSING_TYPES[0]) params.set("crossing", state.crossing);
  if (state.tab === "overview" && state.evolutionSeries !== DEFAULT_EVOLUTION_SERIES) params.set("evolution", state.evolutionSeries);
  if (state.tab === "reports") {
    if (state.reportsView !== DEFAULT_REPORTS_VIEW) params.set("reportsView", state.reportsView);
    if (state.reportsPage > 1) params.set("reportsPage", String(state.reportsPage));
    if (state.reportsPageSize !== DEFAULT_REPORTS_PAGE_SIZE) params.set("reportsPageSize", String(state.reportsPageSize));
    if (state.reportsSort !== DEFAULT_REPORTS_SORT) params.set("reportsSort", state.reportsSort);
    if (state.reportsDirection !== DEFAULT_REPORTS_DIRECTION) params.set("reportsDirection", state.reportsDirection);
    if (state.reportsSearch) params.set("reportsSearch", state.reportsSearch);
    if (state.selectedReportId) params.set("report", state.selectedReportId);
  }

  return params.toString();
}

export function hasActiveFilters(filters: FieldbeatQualityFilters): boolean {
  return Object.values(filters).some(v => v !== undefined);
}

/** Serializa SOLO los filtros comunes (sin tab/crossing/evolution/reportsPage) - la query que overview/quality/crossings realmente envían a la API. */
export function buildFieldbeatFilterQuery(filters: FieldbeatQualityFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.technician) params.set("technician", filters.technician);
  if (filters.client) params.set("client", filters.client);
  if (filters.equipment) params.set("equipment", filters.equipment);
  if (filters.taskType) params.set("taskType", filters.taskType);
  if (filters.origin) params.set("origin", filters.origin);
  if (filters.ticketStatus) params.set("ticketStatus", filters.ticketStatus);
  if (filters.partStatus) params.set("partStatus", filters.partStatus);
  if (filters.qualityStatus) params.set("qualityStatus", filters.qualityStatus);
  if (filters.inconsistencyCode) params.set("inconsistencyCode", filters.inconsistencyCode);
  if (filters.severity) params.set("severity", filters.severity);
  return params.toString();
}

export const EMPTY_FIELDBEAT_QUALITY_FILTERS: FieldbeatQualityFilters = {};

/** Query real que la pestaña Reportes envía a GET /api/dashboard/fieldbeat/reports
 * - filtros comunes + reportsView/page/pageSize/sort/direction/search.
 * Siempre envía page/pageSize (la API los necesita explícitos; distinto del
 * omitir-si-default de la URL visible, que es solo estética de la barra
 * de direcciones). */
export function buildFieldbeatReportsQuery(state: FieldbeatUrlState): string {
  const params = new URLSearchParams(buildFieldbeatFilterQuery(state.filters));
  params.set("reportsView", state.reportsView);
  params.set("page", String(state.reportsPage));
  params.set("pageSize", String(state.reportsPageSize));
  params.set("sort", state.reportsSort);
  params.set("direction", state.reportsDirection);
  if (state.reportsSearch) params.set("search", state.reportsSearch);
  return params.toString();
}

/** Query para GET /api/dashboard/fieldbeat/reports/export - mismos
 * filtros/view/sort/search que la bandeja paginada, SIN page/pageSize (el
 * export cubre el universo filtrado completo hasta MAX_EXPORT_ROWS, nunca
 * solo la página visible). */
export function buildFieldbeatReportsExportQuery(state: FieldbeatUrlState): string {
  const params = new URLSearchParams(buildFieldbeatFilterQuery(state.filters));
  params.set("reportsView", state.reportsView);
  params.set("sort", state.reportsSort);
  params.set("direction", state.reportsDirection);
  if (state.reportsSearch) params.set("search", state.reportsSearch);
  return params.toString();
}
