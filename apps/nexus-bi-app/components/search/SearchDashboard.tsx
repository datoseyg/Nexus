"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchQueryExplanationPanel } from "./SearchQueryExplanationPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SearchForm } from "./SearchForm";
import { SearchTabs } from "./SearchTabs";
import { SearchFilters, type SearchFilterValues } from "./SearchFilters";
import { SearchGroup } from "./SearchGroup";
import { SearchPagination } from "./SearchPagination";
import { SearchDetailDrawerContainer } from "./SearchDetailDrawerContainer";
import { FieldbeatReportDetailDrawer } from "@/components/fieldbeat/quality/FieldbeatReportDetailDrawer";
import { BUTTON_SECONDARY } from "./search.styles";
import { isSearchFiltersResponse, isSearchResponse, type SearchState } from "./search.types";
import { ENTITY_LABELS, ENTITY_ORDER, normalizeSearchQuery, resolveQueryAdjustmentMessage } from "./search.utils";
import type { ConRepuestoFilter, SearchEntity, SearchFiltersResponse } from "@/types/search";

const DEFAULT_CON_REPUESTO: ConRepuestoFilter = "all";
const GROUP_ENTITIES: Array<Exclude<SearchEntity, "all">> = ["clients", "machines", "reports", "tickets", "parts"];

interface UrlState {
  q: string;
  entity: SearchEntity;
  from?: string;
  to?: string;
  cliente?: string;
  maquina?: string;
  tipoTarea?: string;
  estadoTicket?: string;
  conRepuesto: ConRepuestoFilter;
  page: number;
  /** HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - reporte
   * abierto en el drawer canónico, persistido en la URL (mismo patrón que
   * selectedReportId en lib/fieldbeat-tabs-url-state.ts) - permite compartir/
   * recargar un enlace directo a un reporte abierto desde Búsqueda. */
  report?: string;
}

function readUrlState(params: URLSearchParams): UrlState {
  const rawEntity = params.get("entity") ?? "all";
  const entity = (ENTITY_ORDER as string[]).includes(rawEntity) ? (rawEntity as SearchEntity) : "all";
  const rawConRepuesto = params.get("conRepuesto") ?? "all";
  const conRepuesto: ConRepuestoFilter = rawConRepuesto === "yes" || rawConRepuesto === "no" ? rawConRepuesto : "all";
  return {
    q: params.get("q") ?? "",
    entity,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    cliente: params.get("cliente") || undefined,
    maquina: params.get("maquina") || undefined,
    tipoTarea: params.get("tipoTarea") || undefined,
    estadoTicket: params.get("estadoTicket") || undefined,
    conRepuesto,
    page: Math.max(1, Number(params.get("page")) || 1),
    report: params.get("report") || undefined
  };
}

function buildQueryString(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.entity !== "all") params.set("entity", state.entity);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.cliente) params.set("cliente", state.cliente);
  if (state.maquina) params.set("maquina", state.maquina);
  if (state.tipoTarea) params.set("tipoTarea", state.tipoTarea);
  if (state.estadoTicket) params.set("estadoTicket", state.estadoTicket);
  if (state.conRepuesto !== "all") params.set("conRepuesto", state.conRepuesto);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.report) params.set("report", state.report);
  return params.toString();
}

export function SearchDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlState = useMemo(() => readUrlState(searchParams), [searchParams]);
  const [filtersOptions, setFiltersOptions] = useState<SearchFiltersResponse | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [detailRequest, setDetailRequest] = useState<{ entity: Exclude<SearchEntity, "all">; key: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/search/filters", { cache: "no-store" })
      .then(async res => {
        const body: unknown = await res.json();
        if (res.ok && isSearchFiltersResponse(body)) setFiltersOptions(body);
      })
      .catch(() => {
        /* Filtros opcionales - la búsqueda sigue funcionando sin ellos. */
      });
  }, []);

  function pushState(patch: Partial<UrlState>, resetPage: boolean) {
    const next: UrlState = { ...urlState, ...patch, page: resetPage ? 1 : (patch.page ?? urlState.page) };
    const qs = buildQueryString(next);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const normalized = useMemo(() => normalizeSearchQuery(urlState.q), [urlState.q]);
  const hasCommittedQuery = urlState.q.trim().length > 0;
  const isInvalid = hasCommittedQuery && normalized.tokens.length === 0;

  const requestKey = JSON.stringify(urlState) + `|retry:${retryCount}`;

  useEffect(() => {
    abortRef.current?.abort();

    if (!hasCommittedQuery) {
      setSearchState({ status: "idle" });
      return;
    }
    if (isInvalid) {
      setSearchState({ status: "invalid" });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSearchState({ status: "loading" });

    const params = new URLSearchParams();
    params.set("q", urlState.q);
    params.set("entity", urlState.entity);
    if (urlState.from) params.set("from", urlState.from);
    if (urlState.to) params.set("to", urlState.to);
    if (urlState.cliente) params.set("cliente", urlState.cliente);
    if (urlState.maquina) params.set("maquina", urlState.maquina);
    if (urlState.tipoTarea) params.set("tipoTarea", urlState.tipoTarea);
    if (urlState.estadoTicket) params.set("estadoTicket", urlState.estadoTicket);
    if (urlState.conRepuesto !== "all") params.set("conRepuesto", urlState.conRepuesto);
    if (urlState.entity !== "all") params.set("page", String(urlState.page));

    fetch(`/api/search?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        const body: unknown = await res.json();
        if (!res.ok) {
          const message = typeof body === "object" && body && "error" in body ? String((body as Record<string, unknown>).error) : "Error desconocido";
          setSearchState({ status: "error", message });
          return;
        }
        if (!isSearchResponse(body)) {
          setSearchState({ status: "error", message: "Respuesta de búsqueda con forma inesperada." });
          return;
        }
        setSearchState(body.counts.all === 0 ? { status: "empty", data: body } : { status: "success", data: body });
      })
      .catch(error => {
        if (error?.name === "AbortError") return;
        setSearchState({ status: "error", message: "No se pudo completar la búsqueda." });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const handleSubmit = useCallback(
    (query: string) => {
      pushState({ q: query.trim() }, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlState]
  );

  const handleClearAll = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  const handleClearFilters = useCallback(() => {
    pushState(
      { from: undefined, to: undefined, cliente: undefined, maquina: undefined, tipoTarea: undefined, estadoTicket: undefined, conRepuesto: DEFAULT_CON_REPUESTO },
      true
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState]);

  const handleFilterChange = useCallback(
    (patch: Partial<SearchFilterValues>) => {
      pushState(patch, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlState]
  );

  const handleEntityChange = useCallback(
    (entity: SearchEntity) => {
      pushState({ entity }, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlState]
  );

  const handlePageChange = useCallback(
    (page: number) => {
      pushState({ page }, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlState]
  );

  // HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - el
  // reporte abierto vive en la URL (state.report, mismo patrón que
  // selectedReportId en lib/fieldbeat-tabs-url-state.ts) - nunca en un
  // useState local, para que un enlace directo con ?report=<id> sea
  // compartible/recargable. Un resultado de la entidad "reports" NUNCA abre
  // el drawer propio de Search - abre directo el canónico (row.key ===
  // fieldbeatTaskId para reportes, ver mapReportRow() en lib/search-sql.ts).
  const openDetail = useCallback(
    (entity: Exclude<SearchEntity, "all">, key: string) => {
      if (entity === "reports") {
        pushState({ report: key }, false);
        return;
      }
      setDetailRequest({ entity, key });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlState]
  );
  const closeDetail = useCallback(() => setDetailRequest(null), []);
  // Filas "relacionadas" (reportes recientes/vinculados/usos) dentro del
  // drawer propio de Search - cierra ESE drawer en el mismo cambio de
  // estado que abre el canónico (vía la URL), nunca dos diálogos apilados.
  const openReport = useCallback(
    (reportId: string) => {
      setDetailRequest(null);
      pushState({ report: reportId }, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlState]
  );
  const closeReport = useCallback(() => pushState({ report: undefined }, false), [urlState]);
  const handleRetry = useCallback(() => setRetryCount(c => c + 1), []);

  const filterValues: SearchFilterValues = {
    from: urlState.from,
    to: urlState.to,
    cliente: urlState.cliente,
    maquina: urlState.maquina,
    tipoTarea: urlState.tipoTarea,
    estadoTicket: urlState.estadoTicket,
    conRepuesto: urlState.conRepuesto
  };

  const counts = searchState.status === "success" || searchState.status === "empty" ? searchState.data.counts : null;
  const adjustmentMessage =
    (searchState.status === "success" || searchState.status === "empty") && searchState.data.queryAdjusted
      ? resolveQueryAdjustmentMessage(searchState.data.queryAdjustmentReasons)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sr-only">
        {searchState.status === "loading" && "Buscando…"}
        {searchState.status === "error" && `Error: ${searchState.message}`}
        {searchState.status === "empty" && "Sin resultados para esta búsqueda."}
      </div>

      <SearchForm initialQuery={urlState.q} loading={searchState.status === "loading"} onSubmit={handleSubmit} onClearAll={handleClearAll} />

      {hasCommittedQuery && (
        <>
          <SearchTabs active={urlState.entity} counts={counts} onChange={handleEntityChange} />

          <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
            <SearchFilters values={filterValues} options={filtersOptions} onChange={handleFilterChange} onClear={handleClearFilters} />
          </div>
        </>
      )}

      {searchState.status === "invalid" && (
        <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
          Escribe al menos una palabra de 2 o más caracteres para buscar.
        </p>
      )}

      {searchState.status === "loading" && (
        <p aria-busy="true" style={{ color: "var(--nx-text-secondary)" }}>
          Buscando…
        </p>
      )}

      {searchState.status === "error" && (
        <div role="alert" className="flex flex-col gap-2">
          <ErrorBanner message={searchState.message} />
          <button
            type="button"
            onClick={handleRetry}
            className={`self-start whitespace-nowrap rounded-[var(--nx-radius-button)] border px-4 text-[13px] font-semibold ${BUTTON_SECONDARY}`}
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", minHeight: 44 }}
          >
            Reintentar
          </button>
        </div>
      )}

      {(searchState.status === "success" || searchState.status === "empty") && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px]" style={{ color: "var(--nx-text-secondary)" }}>
              {urlState.entity === "all"
                ? `${searchState.data.counts.all.toLocaleString("es-CL")} coincidencias entre todas las categorías para "${searchState.data.query}"`
                : `${(searchState.data.counts[urlState.entity as Exclude<SearchEntity, "all">] ?? 0).toLocaleString("es-CL")} ${ENTITY_LABELS[urlState.entity].toLowerCase()} para "${searchState.data.query}"`}
            </p>
          </div>
          {adjustmentMessage && (
            <p className="text-[12.5px]" style={{ color: "var(--nx-text-muted)" }}>
              {adjustmentMessage}
            </p>
          )}

          {searchState.status === "empty" && <EmptyState title="Sin resultados" description="Prueba con otros términos o menos filtros." />}

          {searchState.status === "success" && urlState.entity === "all" && (
            <div className="flex flex-col gap-4">
              {GROUP_ENTITIES.filter(entity => searchState.data.counts[entity] > 0).map(entity => (
                <SearchGroup
                  key={entity}
                  entity={entity}
                  rows={searchState.data.groups[entity]}
                  totalCount={searchState.data.counts[entity]}
                  onOpenDetail={openDetail}
                  onViewAll={() => handleEntityChange(entity)}
                />
              ))}
            </div>
          )}

          {searchState.status === "success" && urlState.entity !== "all" && (
            <div className="flex flex-col gap-3">
              <SearchGroup
                entity={urlState.entity}
                rows={searchState.data.groups[urlState.entity]}
                totalCount={searchState.data.counts[urlState.entity]}
                onOpenDetail={openDetail}
              />
              {searchState.data.pagination && searchState.data.pagination.totalPages > 1 && (
                <SearchPagination
                  page={searchState.data.pagination.page}
                  totalPages={searchState.data.pagination.totalPages}
                  totalRows={searchState.data.pagination.total}
                  onPageChange={handlePageChange}
                />
              )}
            </div>
          )}

          {searchState.data.queryExplanation && <SearchQueryExplanationPanel explanation={searchState.data.queryExplanation} />}
        </>
      )}

      <SearchDetailDrawerContainer request={detailRequest} onClose={closeDetail} onOpenReport={openReport} />
      <FieldbeatReportDetailDrawer reportId={urlState.report ?? null} onClose={closeReport} />
    </div>
  );
}
