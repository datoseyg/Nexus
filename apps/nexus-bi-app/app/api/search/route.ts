import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { normalizeSearchQuery } from "@/lib/search-query-normalizer";
import { createParamPusher, parseSearchFilters, SearchValidationError, type SearchFilters } from "@/lib/search-filters";
import {
  buildConsolidatedCountsQuery,
  buildEntityRowsQuery,
  createQueryTimer,
  getReportFieldsAvailability,
  mapClientRow,
  mapMachineRow,
  mapPartRow,
  mapReportRow,
  mapTicketRow,
  toSafeCount
} from "@/lib/search-sql";
import type { SearchCounts, SearchEntity, SearchGroups, SearchQueryExplanation, SearchResponse } from "@/types/search";

export const runtime = "nodejs";

const PREVIEW_LIMIT = 5;
const ALL_ENTITIES: Array<Exclude<SearchEntity, "all">> = ["reports", "tickets", "clients", "machines", "parts"];

const ENTITY_LABELS: Record<Exclude<SearchEntity, "all">, string> = {
  reports: "Reportes",
  tickets: "Tickets",
  clients: "Clientes",
  machines: "Equipos",
  parts: "Repuestos"
};

// Gate B (B24/21.12) - "SQL ejecutada" retirado de la experiencia productiva
// para ambos roles: reemplazado por una explicación en lenguaje de negocio,
// nunca por schema/tabla/columna/join/SQL. Los valores de filtro se
// muestran tal como el usuario los ingresó (ya son suyos, no un secreto),
// nunca interpolados dentro de un fragmento de SQL.
function buildQueryExplanation(filters: SearchFilters, entities: Array<Exclude<SearchEntity, "all">>): SearchQueryExplanation {
  const filtersApplied: Array<{ label: string; value: string }> = [];
  if (filters.from) filtersApplied.push({ label: "Desde", value: filters.from });
  if (filters.to) filtersApplied.push({ label: "Hasta", value: filters.to });
  if (filters.cliente) filtersApplied.push({ label: "Cliente", value: filters.cliente });
  if (filters.maquina) filtersApplied.push({ label: "Equipo", value: filters.maquina });
  if (filters.tipoTarea) filtersApplied.push({ label: "Tipo de tarea", value: filters.tipoTarea });
  if (filters.estadoTicket) filtersApplied.push({ label: "Estado de ticket", value: filters.estadoTicket });
  if (filters.conRepuesto !== "all") filtersApplied.push({ label: "Con repuesto", value: filters.conRepuesto === "yes" ? "Sí" : "No" });

  return {
    entitiesSearched: entities.map(e => ENTITY_LABELS[e]),
    filtersApplied,
    resultRelation: "Resultados agrupados por tipo de entidad, cada uno con su propio conteo total.",
    resultLimits:
      entities.length > 1
        ? [`Vista combinada: hasta ${PREVIEW_LIMIT} resultados por tipo de entidad.`]
        : [`Página de ${filters.pageSize} resultados.`]
  };
}

function emptyGroups(): SearchGroups {
  return { reports: [], tickets: [], clients: [], machines: [], parts: [] };
}

function mapEntityRows(entity: Exclude<SearchEntity, "all">, rows: Record<string, unknown>[]) {
  if (entity === "reports") return rows.map(mapReportRow);
  if (entity === "clients") return rows.map(mapClientRow);
  if (entity === "machines") return rows.map(mapMachineRow);
  if (entity === "tickets") return rows.map(mapTicketRow);
  return rows.map(mapPartRow);
}

export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const timer = createQueryTimer();

  try {
    const filters: SearchFilters = parseSearchFilters(request.nextUrl.searchParams);
    const normalized = normalizeSearchQuery(filters.q);

    if (normalized.tokens.length === 0) {
      throw new SearchValidationError("q debe contener al menos un token de 2 o más caracteres.");
    }

    const reportFieldsAvailable = await timer.timed("capability-check", () => getReportFieldsAvailability());

    const countsPusher = createParamPusher();
    const countsQuery = buildConsolidatedCountsQuery(filters, normalized.tokens, reportFieldsAvailable, countsPusher);
    const countsRows = await timer.timed("counts", () => runQuery<Record<string, unknown>>(countsQuery.sql, countsQuery.params));
    const countsRow = countsRows[0] ?? {};

    const counts: SearchCounts = {
      reports: toSafeCount(countsRow.reports),
      tickets: toSafeCount(countsRow.tickets),
      clients: toSafeCount(countsRow.clients),
      machines: toSafeCount(countsRow.machines),
      parts: toSafeCount(countsRow.parts),
      all: 0
    };
    counts.all = counts.reports + counts.tickets + counts.clients + counts.machines + counts.parts;

    const groups = emptyGroups();

    if (filters.entity === "all") {
      const nonEmptyEntities: Array<Exclude<SearchEntity, "all">> = [];
      for (const entity of ALL_ENTITIES) {
        if (counts[entity] === 0) continue;
        nonEmptyEntities.push(entity);
        const pusher = createParamPusher();
        const rowsQuery = buildEntityRowsQuery(entity, filters, normalized.tokens, reportFieldsAvailable, pusher, PREVIEW_LIMIT, 0);
        const rawRows = await timer.timed(`preview:${entity}`, () => runQuery<Record<string, unknown>>(rowsQuery.sql, rowsQuery.params));
        (groups[entity] as unknown[]) = mapEntityRows(entity, serializeRows(rawRows));
      }

      const response: SearchResponse = {
        query: normalized.effectiveQuery,
        entity: "all",
        counts,
        groups,
        pagination: null,
        queryAdjusted: normalized.queryAdjusted,
        queryAdjustmentReasons: normalized.queryAdjustmentReasons,
        queryExplanation: buildQueryExplanation(filters, nonEmptyEntities.length > 0 ? nonEmptyEntities : ALL_ENTITIES)
      };
      console.info(`[search] entity=all queries=${timer.count()} totalMs=${timer.timings.reduce((s, t) => s + t.ms, 0)}`, timer.timings);
      return NextResponse.json(response);
    }

    const entity = filters.entity as Exclude<SearchEntity, "all">;
    const offset = (filters.page - 1) * filters.pageSize;
    const pusher = createParamPusher();
    const rowsQuery = buildEntityRowsQuery(entity, filters, normalized.tokens, reportFieldsAvailable, pusher, filters.pageSize, offset);
    const rawRows = await timer.timed(`page:${entity}`, () => runQuery<Record<string, unknown>>(rowsQuery.sql, rowsQuery.params));
    (groups[entity] as unknown[]) = mapEntityRows(entity, serializeRows(rawRows));

    const total = counts[entity];
    const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

    const response: SearchResponse = {
      query: normalized.effectiveQuery,
      entity,
      counts,
      groups,
      pagination: { page: Math.min(filters.page, totalPages), pageSize: filters.pageSize, total, totalPages },
      queryAdjusted: normalized.queryAdjusted,
      queryAdjustmentReasons: normalized.queryAdjustmentReasons,
      queryExplanation: buildQueryExplanation(filters, [entity])
    };
    console.info(`[search] entity=${entity} queries=${timer.count()} totalMs=${timer.timings.reduce((s, t) => s + t.ms, 0)}`, timer.timings);
    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
