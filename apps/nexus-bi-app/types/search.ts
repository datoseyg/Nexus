// Contratos de la Búsqueda global (ETAPA 8). Nombres de campo tal como los
// especificó el encargo original - no una reconstrucción libre.

import type { QueryAdjustmentReason } from "@/lib/search-query-normalizer";

export type SearchEntity = "all" | "reports" | "tickets" | "clients" | "machines" | "parts";
export type ConRepuestoFilter = "all" | "yes" | "no";

export interface SearchClientResult {
  key: string;
  clientName: string;
  reportCount: number;
  ticketCount: number;
  machineCount: number;
}

export interface SearchMachineResult {
  key: string;
  machineId: string;
  clientName: string | null;
  reportCount: number;
  ticketCount: number;
}

export interface SearchReportResult {
  key: string;
  fieldbeatTaskId: string;
  date: string | null;
  clientName: string | null;
  machineId: string | null;
  taskType: string | null;
  ticketId: string | null;
  snippet: string | null;
  hasParts: boolean;
}

export interface SearchTicketResult {
  key: string;
  ticketId: string;
  status: string | null;
  title: string | null;
  clientName: string | null;
  linkedReportCount: number;
  date: string | null;
}

export interface SearchPartResult {
  key: string;
  sku: string | null;
  partName: string | null;
  rawIdentifier: string | null;
  quantityConsumed: number;
  reportCount: number;
  clientCount: number;
}

export interface SearchCounts {
  reports: number;
  tickets: number;
  clients: number;
  machines: number;
  parts: number;
  all: number;
}

export interface SearchGroups {
  reports: SearchReportResult[];
  tickets: SearchTicketResult[];
  clients: SearchClientResult[];
  machines: SearchMachineResult[];
  parts: SearchPartResult[];
}

export interface SearchPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Gate B (B24/21.12) - "SQL ejecutada" retirado de la experiencia productiva
// para ambos roles (decisión cerrada de Gate A). Reemplazado por una
// explicación en lenguaje de negocio: qué entidades se consultaron, qué
// filtros aplicaron, cómo se relacionan los resultados, y qué límites tiene
// la vista - NUNCA schema/tabla/columna/join/SQL, ni siquiera en una capacidad
// técnica separada (se retira, no se restringe).
export interface SearchQueryExplanation {
  entitiesSearched: string[];
  filtersApplied: Array<{ label: string; value: string }>;
  resultRelation: string;
  resultLimits: string[];
}

export interface SearchResponse {
  /** Consulta EFECTIVA (post recorte/tokenización) - nunca el q crudo. */
  query: string;
  entity: SearchEntity;
  counts: SearchCounts;
  groups: SearchGroups;
  pagination: SearchPagination | null;
  queryAdjusted: boolean;
  queryAdjustmentReasons: QueryAdjustmentReason[];
  queryExplanation: SearchQueryExplanation;
}

export type SearchFiltersResponse = {
  dateRange: { min: string | null; max: string | null };
  clientes: string[];
  maquinas: string[];
  tiposTarea: string[];
  estadosTicket: string[];
};

// HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - "reports"
// eliminado: Search ya NUNCA abre su propio drawer para un reporte, abre
// directo el canónico (FieldbeatReportDetailDrawer) vía fieldbeatTaskId -
// ver SearchDashboard.tsx.
export type SearchDetailResponse =
  | { entity: "clients"; summary: SearchClientResult; recentReports: SearchReportResult[]; machines: SearchMachineResult[]; tickets: SearchTicketResult[] }
  | { entity: "machines"; summary: SearchMachineResult; recentReports: SearchReportResult[] }
  | { entity: "tickets"; summary: SearchTicketResult; linkedReports: SearchReportResult[] }
  | { entity: "parts"; summary: SearchPartResult; recentUsages: SearchReportResult[] };
