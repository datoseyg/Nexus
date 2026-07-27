"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import {
  readFieldbeatUrlState,
  buildFieldbeatQueryString,
  buildFieldbeatFilterQuery,
  buildFieldbeatReportsQuery,
  buildFieldbeatReportsExportQuery,
  EMPTY_FIELDBEAT_QUALITY_FILTERS,
  type FieldbeatUrlState,
  type FieldbeatTab
} from "@/lib/fieldbeat-tabs-url-state";
import type { FieldbeatReportsDirection, FieldbeatReportsSortKey, FieldbeatReportsView } from "@/types/fieldbeat-reports";
import type { FieldbeatQualityFilters } from "@/lib/fieldbeat-quality-filters";
import type { FieldbeatHeaderMeta } from "@/lib/fieldbeat-header-meta";
import type { FieldbeatQualityFilterOptions } from "@/types/fieldbeat-quality";
import type { CrossingType } from "@/types/fieldbeat-crossings";
import { FieldbeatQualityHeader } from "./FieldbeatQualityHeader";
import { FieldbeatQualityTabs } from "./FieldbeatQualityTabs";
import { FieldbeatQualityFilterBar } from "./FieldbeatQualityFilterBar";
import { FieldbeatOverviewTab } from "./FieldbeatOverviewTab";
import { FieldbeatQualityTab } from "./FieldbeatQualityTab";
import { FieldbeatCrossingsTab } from "./FieldbeatCrossingsTab";
import { FieldbeatReportsTab } from "./FieldbeatReportsTab";
import { FieldbeatReportDetailDrawer } from "./FieldbeatReportDetailDrawer";

function isFilterOptionsEmpty(body: FieldbeatQualityFilterOptions): boolean {
  return body.clientes.length === 0 && body.tiposTarea.length === 0;
}

const FIELDBEAT_LIGHT_SCOPE_STYLE = {
  background: "var(--nx-page-bg)",
  "--eyg-card": "#ffffff",
  "--eyg-border": "#dde6e3",
  "--eyg-green-dark": "#3c8c2e",
  "--eyg-warning": "#f4b740",
  "--eyg-danger": "#d9534f",
  "--surface-1": "#ffffff",
  "--page-plane": "#f4f7f6",
  "--text-primary": "#243033",
  "--text-secondary": "#5e6b70",
  "--text-muted": "#8a9a95",
  "--gridline": "#dde6e3",
  "--axis": "#b7c9c3",
  "--border": "#dde6e3",
  "--series-1": "#3c8c2e",
  "--status-good": "#3c8c2e",
  "--status-warning": "#f4b740",
  "--status-serious": "#e08e3e",
  "--status-critical": "#d9534f"
} as React.CSSProperties;

// Phase 3 - orquestador de las 4 pestañas (overview/quality/crossings/
// reports), estado de filtros y tab en la URL (mismo idioma que
// components/search/SearchDashboard.tsx: useSearchParams + router.push +
// readUrlState/buildQueryString puros - ver investigación previa, NUNCA el
// patrón useState local no persistido de DashboardShell/
// AuditManualReviewShell). Reemplaza a FieldbeatShell.tsx (ver dead-code
// removal, cierre de Phase 3).
//
// Montaje condicional real (no display:none) para cada pestaña -
// garantiza "cero requests antes de abrir" Cruces/Reportes/Calidad por
// construcción: el hook de fetch de un componente no desmontado nunca
// corre.
function FieldbeatQualityShellInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlState = useMemo(() => readFieldbeatUrlState(searchParams), [searchParams]);

  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [headerMeta, setHeaderMeta] = useState<FieldbeatHeaderMeta | null>(null);

  const filterOptionsSection = useAfterHoursSection<FieldbeatQualityFilterOptions>("/api/dashboard/fieldbeat/filters", "", isFilterOptionsEmpty);

  function pushState(patch: Partial<FieldbeatUrlState>) {
    const next: FieldbeatUrlState = { ...urlState, ...patch };
    const qs = buildFieldbeatQueryString(next);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function handleTabChange(tab: FieldbeatTab) {
    pushState({ tab });
  }

  function handleFiltersChange(next: FieldbeatQualityFilters) {
    pushState({ filters: next, reportsPage: 1 });
  }

  function handleClearFilters() {
    pushState({ filters: EMPTY_FIELDBEAT_QUALITY_FILTERS, reportsPage: 1 });
  }

  function handleDrillDown(patch: Record<string, string>) {
    if (patch.tab) pushState({ tab: patch.tab as FieldbeatTab });
  }

  const dataQuery = useMemo(() => buildFieldbeatFilterQuery(urlState.filters), [urlState.filters]);
  const reportsQuery = useMemo(() => buildFieldbeatReportsQuery(urlState), [urlState]);
  const reportsExportQuery = useMemo(() => buildFieldbeatReportsExportQuery(urlState), [urlState]);

  return (
    <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={FIELDBEAT_LIGHT_SCOPE_STYLE}>
      <FieldbeatQualityHeader
        effectiveDateFrom={headerMeta?.effectiveDateFrom ?? urlState.filters.dateFrom ?? null}
        effectiveDateTo={headerMeta?.effectiveDateTo ?? urlState.filters.dateTo ?? null}
        generatedAt={headerMeta?.generatedAt ?? null}
        totalReportsLabel={headerMeta ? `${headerMeta.totalReports.toLocaleString("es-CL")} reportes cerrados evaluables` : null}
        clientCount={filterOptionsSection.data?.clientes.length ?? null}
        equipmentCount={filterOptionsSection.data?.equipos.length ?? null}
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <FieldbeatQualityTabs active={urlState.tab} onChange={handleTabChange} />

        <FieldbeatQualityFilterBar
          filters={urlState.filters}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
          filterOptions={filterOptionsSection.data}
          moreFiltersOpen={moreFiltersOpen}
          onToggleMoreFilters={() => setMoreFiltersOpen(v => !v)}
        />

        <div role="tabpanel" id={`fieldbeat-tabpanel-${urlState.tab}`} aria-labelledby={`fieldbeat-tab-${urlState.tab}`} tabIndex={0}>
          {urlState.tab === "overview" && (
            <FieldbeatOverviewTab
              query={dataQuery}
              evolutionSeries={urlState.evolutionSeries}
              onEvolutionSeriesChange={series => pushState({ evolutionSeries: series })}
              onDrillDown={handleDrillDown}
              onMeta={setHeaderMeta}
            />
          )}
          {urlState.tab === "quality" && <FieldbeatQualityTab query={dataQuery} onMeta={setHeaderMeta} />}
          {urlState.tab === "crossings" && (
            <FieldbeatCrossingsTab crossing={urlState.crossing} onCrossingChange={(type: CrossingType) => pushState({ crossing: type })} query={dataQuery} />
          )}
          {urlState.tab === "reports" && (
            <FieldbeatReportsTab
              query={reportsQuery}
              exportQuery={reportsExportQuery}
              view={urlState.reportsView}
              page={urlState.reportsPage}
              pageSize={urlState.reportsPageSize}
              sort={urlState.reportsSort}
              direction={urlState.reportsDirection}
              search={urlState.reportsSearch}
              selectedReportId={urlState.selectedReportId}
              onViewChange={(view: FieldbeatReportsView) => pushState({ reportsView: view, reportsPage: 1 })}
              onPageChange={page => pushState({ reportsPage: page })}
              onPageSizeChange={pageSize => pushState({ reportsPageSize: pageSize, reportsPage: 1 })}
              onSortChange={(sort: FieldbeatReportsSortKey, direction: FieldbeatReportsDirection) => pushState({ reportsSort: sort, reportsDirection: direction, reportsPage: 1 })}
              onSearchChange={(search: string | null) => pushState({ reportsSearch: search, reportsPage: 1 })}
              onSelectReport={(id: string | null) => pushState({ selectedReportId: id })}
            />
          )}
        </div>
      </div>

      <FieldbeatReportDetailDrawer reportId={urlState.selectedReportId} onClose={() => pushState({ selectedReportId: null })} />
    </div>
  );
}

// useSearchParams() exige un límite <Suspense> en el Server Component
// padre (mismo requisito que app/search/page.tsx).
export function FieldbeatQualityShell() {
  return (
    <Suspense fallback={<div className="p-6 text-sm" style={{ color: "var(--nx-text-secondary)" }}>Cargando…</div>}>
      <FieldbeatQualityShellInner />
    </Suspense>
  );
}
