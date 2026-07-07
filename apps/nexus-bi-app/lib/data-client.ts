// Dispatcher único de datos - elige la fuente correcta según
// NEXT_PUBLIC_DATA_MODE (ver lib/data-mode.ts):
//   - local-duckdb -> Route Handlers actuales /api/dashboard/* y /api/audit/*
//   - static       -> JSON pre-generado /data/cloud/*.json (lib/static-data-client.ts)
//   - d1           -> Pages Functions /api/d1/* (Cloudflare D1, ver functions/api/d1/)
//
// Los componentes existentes (OperationalDashboardTab, AuditManualReviewShell,
// etc.) siguen llamando /api/* directo por ahora - este módulo es la pieza
// que falta cablear para que dejen de depender del modo. Ver
// docs/CLOUD_SMOKE_TEST.md y docs/CLOUDFLARE_D1_MIGRATION.md.

import { getDataMode } from "./data-mode";
import * as staticClient from "./static-data-client";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} devolvió ${response.status}`);
  return (await response.json()) as T;
}

class DataModeUnsupportedError extends Error {
  constructor(feature: string, mode: string) {
    super(`"${feature}" no está disponible en modo "${mode}" todavía.`);
    this.name = "DataModeUnsupportedError";
  }
}

export function getOperationalSummary(): Promise<Record<string, unknown>> {
  switch (getDataMode()) {
    case "static":
      return staticClient.getOperationalSummary();
    case "d1":
      return fetchJson("/api/d1/operational-summary");
    default:
      return fetchJson("/api/dashboard/operacional/summary");
  }
}

export interface FieldbeatSummaryFilters {
  client?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface FieldbeatSummaryRow extends Record<string, unknown> {
  fieldbeat_task_id: number;
  fieldbeat_task_date: string | null;
  client_name: string | null;
  task_type: string | null;
  task_state: string | null;
  used_parts_count: number | null;
  matched_used_parts_count: number | null;
  report_quality_status: string | null;
}

export interface FieldbeatSummaryResponse {
  source: "local-duckdb" | "d1";
  data: FieldbeatSummaryRow[];
  meta: {
    total: number;
    totalUsedParts: number;
    clientOptions: string[];
    filters: Required<FieldbeatSummaryFilters>;
  };
}

// Sin equivalente en el snapshot estático de Fase 1 (no se exportó
// fieldbeat-summary.json) - solo local-duckdb y d1 lo sirven hoy. Mismo
// contrato { source, data, meta } en ambos modos - ver
// app/api/dashboard/fieldbeat/route.ts y functions/api/d1/fieldbeat-summary.ts.
export function getFieldbeatSummary(filters?: FieldbeatSummaryFilters): Promise<FieldbeatSummaryResponse> {
  const mode = getDataMode();
  if (mode === "static") throw new DataModeUnsupportedError("getFieldbeatSummary", mode);

  const qs = new URLSearchParams();
  if (filters?.client) qs.set("client", filters.client);
  if (filters?.q) qs.set("q", filters.q);
  if (filters?.from) qs.set("from", filters.from);
  if (filters?.to) qs.set("to", filters.to);
  const query = qs.toString() ? `?${qs.toString()}` : "";

  if (mode === "d1") return fetchJson(`/api/d1/fieldbeat-summary${query}`);
  return fetchJson(`/api/dashboard/fieldbeat${query}`);
}

export function getAuditSummary(): Promise<Record<string, unknown>> {
  switch (getDataMode()) {
    case "static":
      return staticClient.getAuditSummary();
    case "d1":
      return fetchJson("/api/d1/audit-summary");
    default:
      return fetchJson("/api/audit/summary");
  }
}

// static: muestra fija de 20 filas (ver audit-manual-review.sample.json).
// d1/local-duckdb: consultan en vivo, aceptan `q` (búsqueda) y paginación.
export function getPartsReview(params?: { q?: string; limit?: number; offset?: number }): Promise<Record<string, unknown>> {
  const mode = getDataMode();
  if (mode === "static") return staticClient.getAuditManualReviewSample();

  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs.toString()}` : "";

  if (mode === "d1") return fetchJson(`/api/d1/parts-review${query}`);
  return fetchJson(`/api/audit/parts-review${query}`);
}

export function getAfterHoursSummary(): Promise<Record<string, unknown>> {
  switch (getDataMode()) {
    case "static":
      return staticClient.getAfterHoursSummary();
    case "d1":
      return fetchJson("/api/d1/after-hours-summary");
    default:
      return fetchJson("/api/dashboard/after-hours/summary");
  }
}

// Solo d1 - diagnóstico post-deploy (filas por tabla D1), ver
// functions/api/d1/table-counts.ts.
export function getD1TableCounts(): Promise<Record<string, unknown>> {
  const mode = getDataMode();
  if (mode !== "d1") throw new DataModeUnsupportedError("getD1TableCounts", mode);
  return fetchJson("/api/d1/table-counts");
}
