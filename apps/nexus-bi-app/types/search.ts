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

export interface SearchResponse {
  /** Consulta EFECTIVA (post recorte/tokenización) - nunca el q crudo. */
  query: string;
  entity: SearchEntity;
  counts: SearchCounts;
  groups: SearchGroups;
  pagination: SearchPagination | null;
  queryAdjusted: boolean;
  queryAdjustmentReasons: QueryAdjustmentReason[];
  queries?: Array<{ label: string; sql: string }>;
}

export type SearchFiltersResponse = {
  dateRange: { min: string | null; max: string | null };
  clientes: string[];
  maquinas: string[];
  tiposTarea: string[];
  estadosTicket: string[];
};

export type SearchDetailResponse =
  | { entity: "clients"; summary: SearchClientResult; recentReports: SearchReportResult[]; machines: SearchMachineResult[]; tickets: SearchTicketResult[] }
  | { entity: "machines"; summary: SearchMachineResult; recentReports: SearchReportResult[] }
  | { entity: "reports"; summary: SearchReportResult; fields: Array<{ label: string; value: string | number | null }>; parts: SearchPartResult[] }
  | { entity: "tickets"; summary: SearchTicketResult; linkedReports: SearchReportResult[] }
  | { entity: "parts"; summary: SearchPartResult; recentUsages: SearchReportResult[] };
