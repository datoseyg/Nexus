import type { SearchDetailResponse, SearchFiltersResponse, SearchResponse } from "@/types/search";

// Estado de la búsqueda principal - los 6 estados exigidos por el encargo,
// nunca combinaciones contradictorias (ej. loading+data+error).
export type SearchState =
  | { status: "idle" }
  | { status: "invalid" }
  | { status: "loading" }
  | { status: "success"; data: SearchResponse }
  | { status: "empty"; data: SearchResponse }
  | { status: "error"; message: string };

// Estado del detalle - independiente del estado de la búsqueda principal,
// con su propio ciclo de vida (abort controller propio en el contenedor).
export type DetailState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "success"; data: SearchDetailResponse }
  | { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === "string");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Predicate runtime real - nunca se asume la forma de un body de fetch sin validarla. */
export function isSearchFiltersResponse(value: unknown): value is SearchFiltersResponse {
  if (!isRecord(value)) return false;
  const dr = value.dateRange;
  if (!isRecord(dr)) return false;
  if (!(dr.min === null || typeof dr.min === "string")) return false;
  if (!(dr.max === null || typeof dr.max === "string")) return false;
  return isStringArray(value.clientes) && isStringArray(value.maquinas) && isStringArray(value.tiposTarea) && isStringArray(value.estadosTicket);
}

export function isSearchResponse(value: unknown): value is SearchResponse {
  if (!isRecord(value)) return false;
  if (typeof value.query !== "string") return false;
  if (typeof value.entity !== "string") return false;
  const counts = value.counts;
  if (!isRecord(counts)) return false;
  for (const key of ["reports", "tickets", "clients", "machines", "parts", "all"]) {
    if (!isNumber(counts[key])) return false;
  }
  const groups = value.groups;
  if (!isRecord(groups)) return false;
  for (const key of ["reports", "tickets", "clients", "machines", "parts"]) {
    if (!Array.isArray(groups[key])) return false;
  }
  if (value.pagination !== null && !isRecord(value.pagination)) return false;
  if (typeof value.queryAdjusted !== "boolean") return false;
  if (!Array.isArray(value.queryAdjustmentReasons)) return false;
  return true;
}

export function isSearchDetailResponse(value: unknown): value is SearchDetailResponse {
  if (!isRecord(value)) return false;
  if (typeof value.entity !== "string") return false;
  if (!isRecord(value.summary)) return false;
  return true;
}
