"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useFieldbeatDashboard } from "@/lib/use-fieldbeat-dashboard";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { evaluateFieldbeatPageStatus } from "@/lib/fieldbeat-page-status";
import { buildExecutiveSummary, buildPartsPresence, buildTicketLinkage } from "@/lib/fieldbeat-metrics";
import { toClientReportRankingRows, toEquipmentPartsRankingRows } from "@/lib/fieldbeat-ranking-view";
import {
  toClientActivityRankingRows,
  toEquipmentActivityRankingRows,
  toEvolutionRankingRows,
  toTaskTypeRankingRows
} from "@/lib/fieldbeat-activity-view";
import { EMPTY_FILTERS, type FieldbeatFilterState } from "@/lib/fieldbeat-filter-state";
import { buildFieldbeatQuery } from "@/lib/fieldbeat-query";
import type { FieldbeatActivityResponse, FieldbeatDetailResponse, FieldbeatFilterOptions } from "@/types/fieldbeat";
import { FieldbeatHeader } from "./FieldbeatHeader";
import { FieldbeatAvailabilityBanner } from "./FieldbeatAvailabilityBanner";
import { FieldbeatFilterBar } from "./FieldbeatFilterBar";
import { FieldbeatExecutiveSummary } from "./FieldbeatExecutiveSummary";
import { FieldbeatRankingCard } from "./FieldbeatRankingCard";
import { FieldbeatCrossMatrix } from "./FieldbeatCrossMatrix";
import { FieldbeatClientEquipmentRankings } from "./FieldbeatClientEquipmentRankings";
import { FieldbeatDataQuality } from "./FieldbeatDataQuality";
import { FieldbeatSupportAndPartsSummary } from "./FieldbeatSupportAndPartsSummary";
import { FieldbeatDetailTable } from "./FieldbeatDetailTable";

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

function isFilterOptionsEmpty(body: FieldbeatFilterOptions): boolean {
  return body.clientes.length === 0 && body.tiposTarea.length === 0 && body.equipos.length === 0;
}

function isActivityEmpty(body: FieldbeatActivityResponse): boolean {
  return body.totalFiltered === 0;
}

function isDetailEmpty(body: FieldbeatDetailResponse): boolean {
  return body.totalRows === 0;
}

function recentActivityLabel(activity: FieldbeatActivityResponse | null): string {
  if (!activity?.mostRecentActivity) return "Sin actividad para el filtro actual.";
  const { fecha, cliente } = activity.mostRecentActivity;
  const date = new Date(fecha);
  const dateLabel = Number.isNaN(date.getTime())
    ? fecha
    : date.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
  return cliente ? `${dateLabel} - ${cliente}` : dateLabel;
}

// ETAPA 6 - orquestador de /dashboard/fieldbeat, extendido sobre ETAPA
// 5-V: los 5 agregados GOLD fijos (resumen ejecutivo, calidad de datos,
// rankings de todo el historial) siguen viniendo de useFieldbeatDashboard()
// sin cambios (representan siempre todo el historial, por diseño - ver
// app/api/dashboard/fieldbeat/route.ts). Las secciones que ETAPA 5-V dejó
// como "no disponible" ahora vienen de /activity y /detail, filtradas por
// el mismo estado de filtros (useAfterHoursSection, mismo hook genérico
// que ya usa /dashboard/after-hours - evita respuestas obsoletas/fuera de
// orden por construcción).
export function FieldbeatShell() {
  const { status, data, error, retry } = useFieldbeatDashboard();

  const [filters, setFilters] = useState<FieldbeatFilterState>(EMPTY_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [detailPage, setDetailPage] = useState(1);

  const filtersQuery = useMemo(() => buildFieldbeatQuery(filters), [filters]);
  const detailQuery = useMemo(() => buildFieldbeatQuery(filters, { page: detailPage, pageSize: 20 }), [filters, detailPage]);

  const filterOptions = useAfterHoursSection<FieldbeatFilterOptions>("/api/dashboard/fieldbeat/filters", "", isFilterOptionsEmpty);
  const activity = useAfterHoursSection<FieldbeatActivityResponse>("/api/dashboard/fieldbeat/activity", filtersQuery, isActivityEmpty);
  const detail = useAfterHoursSection<FieldbeatDetailResponse>("/api/dashboard/fieldbeat/detail", detailQuery, isDetailEmpty);

  function handleFiltersChange(next: FieldbeatFilterState) {
    setFilters(next);
    setDetailPage(1);
  }

  const isLoading = status === "idle" || status === "loading";
  const pageStatus = data ? evaluateFieldbeatPageStatus(data) : null;
  const showRealSections = !isLoading && data && (pageStatus === "success" || pageStatus === "partial_inconsistent");

  const executiveSummary = buildExecutiveSummary(data?.kpis ?? null);
  const activityLoading = activity.status === "loading" || activity.status === "idle";
  const activityData = activity.data;

  return (
    <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={FIELDBEAT_LIGHT_SCOPE_STYLE}>
      <FieldbeatHeader recentActivityReason={recentActivityLabel(activityData)} />

      <div className="flex flex-col gap-4 p-4 sm:p-7">
        <FieldbeatAvailabilityBanner />
        <FieldbeatFilterBar
          filters={filters}
          onChange={handleFiltersChange}
          onClear={() => {
            setFilters(EMPTY_FILTERS);
            setDetailPage(1);
          }}
          filterOptions={filterOptions.data}
          moreFiltersOpen={moreFiltersOpen}
          onToggleMoreFilters={() => setMoreFiltersOpen(v => !v)}
        />

        {status === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <ErrorBanner message={error ?? "No fue posible cargar la información de FieldBeat."} />
            <button
              type="button"
              onClick={retry}
              className="rounded-[var(--nx-radius-chip)] px-3.5 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
              style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
                Resumen ejecutivo
              </div>
              <FieldbeatExecutiveSummary summary={executiveSummary} loading={isLoading} />
            </div>

            {!isLoading && pageStatus === "empty" && <EmptyState title="No hay registros FieldBeat disponibles." />}
            {!isLoading && pageStatus === "zero_universe" && (
              <EmptyState title="El universo actual no tiene reportes registrados." description="La base de datos conectada no tiene actividad FieldBeat para mostrar." />
            )}
            {!isLoading && pageStatus === "partial_inconsistent" && (
              <EmptyState
                title="Respuesta con datos inconsistentes"
                description="El resumen general no coincide con la actividad encontrada en otras secciones - se muestra la información disponible a continuación."
              />
            )}

            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              <FieldbeatRankingCard
                title="¿Cómo evoluciona la actividad?"
                description="Reportes de terreno por mes calendario (según filtro actual)"
                rows={activityData ? toEvolutionRankingRows(activityData.evolution) : []}
                loading={activityLoading}
                barColor="var(--nx-accent-indigo)"
              />
              <FieldbeatRankingCard
                title="¿Qué tipos de tarea predominan?"
                description="Distribución de reportes por tipo de tarea (según filtro actual)"
                rows={activityData ? toTaskTypeRankingRows(activityData.taskTypeDistribution) : []}
                loading={activityLoading}
                barColor="var(--nx-accent-green)"
              />
            </div>

            {(isLoading || showRealSections) && (
              <FieldbeatClientEquipmentRankings
                clientRows={data ? toClientReportRankingRows(data.reportsByClient) : []}
                equipmentRows={data ? toEquipmentPartsRankingRows(data.topEquipmentByParts) : []}
                loading={isLoading}
              />
            )}

            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              <FieldbeatRankingCard
                title="Clientes con actividad"
                description="Reportes por cliente (según filtro actual)"
                rows={activityData ? toClientActivityRankingRows(activityData.clientActivity) : []}
                loading={activityLoading}
                barColor="var(--nx-accent-indigo)"
              />
              <FieldbeatRankingCard
                title="Equipos atendidos"
                description="Reportes por equipo (según filtro actual)"
                rows={activityData ? toEquipmentActivityRankingRows(activityData.equipmentActivity) : []}
                loading={activityLoading}
                barColor="var(--nx-accent-green)"
              />
            </div>

            <FieldbeatCrossMatrix
              title="¿Cómo se relacionan clientes y máquinas?"
              description="Cruce de reportes por cliente y equipo (según filtro actual)"
              data={activityData?.clientEquipmentCross ?? { clientes: [], equipos: [], series: [] }}
              columnLabel="equipos"
              loading={activityLoading}
            />
            <FieldbeatCrossMatrix
              title="¿Cómo se distribuye la actividad por cliente y tipo de tarea?"
              description="Reportes por cliente, separados por tipo de tarea (según filtro actual)"
              data={activityData?.clientTaskTypeCross ?? { clientes: [], tiposTarea: [], series: [] }}
              columnLabel="tipos de tarea"
              loading={activityLoading}
            />

            {(isLoading || showRealSections) && <FieldbeatDataQuality rows={data?.dataQuality ?? []} totalReports={data?.kpis?.total_fieldbeat_reports ?? 0} loading={isLoading} />}

            {!isLoading && data?.kpis && <FieldbeatSupportAndPartsSummary linkage={buildTicketLinkage(data.kpis)} presence={buildPartsPresence(data.kpis)} />}

            <FieldbeatDetailTable
              rows={detail.data?.rows ?? []}
              page={detail.data?.page ?? detailPage}
              totalPages={detail.data?.totalPages ?? 1}
              totalRows={detail.data?.totalRows ?? 0}
              onPageChange={setDetailPage}
              loading={detail.status === "loading" || detail.status === "idle"}
            />
          </>
        )}
      </div>
    </div>
  );
}
