// Filtros compartidos de /api/d1/after-hours/* - equivalente D1 de
// apps/nexus-bi-app/lib/after-hours-filters.ts. El prefijo "_" excluye este
// archivo del ruteo de Cloudflare Pages Functions (no es un endpoint).
//
// Fuente en las 7 Functions de esta carpeta: marts_fieldbeat_working_hours_analysis
// (mismo mart que el modo local-duckdb, ya migrado a D1 - ver
// docs/CLOUDFLARE_D1_MIGRATION.md). client_rut/client_key llegan
// enmascarados desde el export, no hace falta tocarlos acá.

export interface AfterHoursFilters {
  client?: string;
  technician?: string;
  taskType?: string;
  from?: string;
  to?: string;
  confidenceLevel?: string;
  onlyAfterHours?: boolean;
  onlyLowConfidence?: boolean;
}

// "" / "all" / "todos" (cualquier capitalización) significa "sin filtro" -
// nunca debe llegar a un WHERE client_name = 'Todos' literal.
const ALL_SENTINELS = new Set(["", "all", "todos"]);
function isRealFilter(value: string | undefined): value is string {
  return !!value && !ALL_SENTINELS.has(value.trim().toLowerCase());
}

export function parseAfterHoursFilters(url: URL): AfterHoursFilters {
  return {
    client: url.searchParams.get("client")?.trim() || undefined,
    technician: url.searchParams.get("technician")?.trim() || undefined,
    taskType: url.searchParams.get("taskType")?.trim() || undefined,
    from: url.searchParams.get("from")?.trim() || undefined,
    to: url.searchParams.get("to")?.trim() || undefined,
    confidenceLevel: url.searchParams.get("confidenceLevel")?.trim() || undefined,
    onlyAfterHours: url.searchParams.get("onlyAfterHours") === "true",
    onlyLowConfidence: url.searchParams.get("onlyLowConfidence") === "true"
  };
}

// Todo el input de usuario viaja en `params` para bindearse con `.bind()` -
// nunca se interpola directo en el SQL. SQLite no soporta `FILTER (WHERE)`
// (extensión DuckDB/Postgres) - los endpoints que necesitan ese patrón usan
// `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` / `AVG(CASE WHEN ... THEN x END)`
// en su propio archivo. Comparación de fechas por substring ISO (los
// primeros 10 caracteres son siempre "YYYY-MM-DD", con o sin offset de
// timezone al final) en vez de `date()` de SQLite, para no depender de que
// parsee bien el formato con offset que exporta DuckDB.
export function buildConditions(filters: AfterHoursFilters, extra: string[] = []): { where: string; params: unknown[] } {
  const conditions: string[] = [...extra];
  const params: unknown[] = [];

  if (isRealFilter(filters.client)) {
    conditions.push("client_name = ?");
    params.push(filters.client);
  }
  if (isRealFilter(filters.technician)) {
    conditions.push("assigned_to = ?");
    params.push(filters.technician);
  }
  if (isRealFilter(filters.taskType)) {
    conditions.push("task_type = ?");
    params.push(filters.taskType);
  }
  if (isRealFilter(filters.from)) {
    conditions.push("substr(start_time_local, 1, 10) >= ?");
    params.push(filters.from);
  }
  if (isRealFilter(filters.to)) {
    conditions.push("substr(start_time_local, 1, 10) <= ?");
    params.push(filters.to);
  }
  if (isRealFilter(filters.confidenceLevel)) {
    conditions.push("confidence_label = ?");
    params.push(filters.confidenceLevel);
  }
  if (filters.onlyAfterHours) conditions.push("is_after_hours_task = 1");
  if (filters.onlyLowConfidence) conditions.push("confidence_score < 65");

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

const CONFIDENCE_TIER_ORDER = ["Insuficiente", "Baja", "Media", "Alta"];
export { CONFIDENCE_TIER_ORDER };

export function getConfidenceLabel(score: number): { label: string } {
  if (score >= 85) return { label: "Alta" };
  if (score >= 65) return { label: "Media" };
  if (score >= 40) return { label: "Baja" };
  return { label: "Insuficiente" };
}
