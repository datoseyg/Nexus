import type { DuckDBValue } from "@duckdb/node-api";
import type { ParamPusher } from "./dashboard-filters";

// Helpers genéricos de filtros - no atados a ninguna vista en particular.
// Objetivo: que la opción "Todos" de un <select> nunca llegue al SQL como
// un valor literal (ver SelectWithAll.tsx, que emite "ALL" como value), y
// que la búsqueda libre (SearchInput.tsx) siga el mismo patrón AND-entre-
// palabras/OR-entre-columnas ya usado en app/api/search/route.ts.
const ALL_SENTINEL = "ALL";

export function normalizeFilterValue(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toUpperCase() === ALL_SENTINEL) return undefined;
  return trimmed;
}

export function isAllFilter(value: string | null | undefined): boolean {
  return normalizeFilterValue(value) === undefined;
}

// Agrega `column = $N` a `conditions` solo si el valor no es "Todos"/vacío -
// evita repetir `if (filters.x) conditions.push(...)` en cada filtro de
// cada endpoint.
export function appendFilterCondition(
  conditions: string[],
  column: string,
  value: string | null | undefined,
  pusher: ParamPusher,
  alias = ""
): void {
  const normalized = normalizeFilterValue(value);
  if (normalized === undefined) return;
  const qualifiedColumn = alias ? `${alias}.${column}` : column;
  conditions.push(`${qualifiedColumn} = ${pusher.push(normalized)}`);
}

const MAX_SEARCH_WORDS = 6;
const MIN_WORD_LENGTH = 2;

function tokenizeSearch(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter(word => word.length >= MIN_WORD_LENGTH)
    .slice(0, MAX_SEARCH_WORDS);
}

// AND entre palabras, OR entre columnas por palabra - mismo criterio que
// buildDescriptionQuery() en app/api/search/route.ts. Devuelve null si `q`
// no tiene ninguna palabra buscable (para que el caller no agregue una
// condición vacía). Siempre parametrizado vía `pusher` - nunca interpola
// el texto de usuario directo en el SQL.
// Un nombre de columna con prefijo "CAST:" se castea a VARCHAR antes del
// ILIKE - necesario para columnas numéricas (ej. fieldbeat_task_id es
// BIGINT en DuckDB, ILIKE exige VARCHAR en ambos lados).
function resolveSearchColumn(name: string, alias: string): string {
  const needsCast = name.startsWith("CAST:");
  const bareName = needsCast ? name.slice("CAST:".length) : name;
  const qualified = alias ? `${alias}.${bareName}` : bareName;
  return needsCast ? `CAST(${qualified} AS VARCHAR)` : qualified;
}

export function buildSearchCondition(
  q: string | null | undefined,
  columns: string[],
  pusher: ParamPusher,
  alias = ""
): string | null {
  if (!q || columns.length === 0) return null;

  const words = tokenizeSearch(q);
  if (words.length === 0) return null;

  const wordConditions = words.map(word => {
    const placeholder = pusher.push(`%${word}%` as DuckDBValue);
    const columnMatches = columns.map(column => `${resolveSearchColumn(column, alias)} ILIKE ${placeholder}`);
    return `(${columnMatches.join(" OR ")})`;
  });

  return wordConditions.join(" AND ");
}
