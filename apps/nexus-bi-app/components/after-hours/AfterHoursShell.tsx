"use client";

import { useMemo, useState } from "react";
import { AfterHoursHeader } from "./AfterHoursHeader";
import { AfterHoursBanner } from "./AfterHoursBanner";
import { AfterHoursFilters, EMPTY_FILTERS, type AfterHoursFilterState } from "./AfterHoursFilters";
import { AfterHoursKpiSection } from "./AfterHoursKpiSection";
import { AfterHoursEvolutionChart } from "./AfterHoursEvolutionChart";
import { AfterHoursRankingCard } from "./AfterHoursRankingCard";
import { AfterHoursWeekdayChart } from "./AfterHoursWeekdayChart";
import { AfterHoursWeekdayHourHeatmap } from "./AfterHoursWeekdayHourHeatmap";
import { AfterHoursTechnicianClientCard } from "./AfterHoursTechnicianClientCard";
import { AfterHoursConfidenceSection } from "./AfterHoursConfidenceSection";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { AfterHoursDetailTable, type DetailSortColumn, type DetailSortDir } from "./AfterHoursDetailTable";
import { FieldbeatReportDetailDrawer } from "@/components/fieldbeat/quality/FieldbeatReportDetailDrawer";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { buildAfterHoursQuery } from "@/lib/after-hours-query";
import { buildAfterHoursDrawerContext } from "@/lib/after-hours-detail-view";
import { isTechnicianClientResponseEmpty, isWeekdayHourResponseEmpty, isWeekdayResponseEmpty } from "@/lib/after-hours-weekday-view";
import type {
  AfterHoursByDimensionRow,
  AfterHoursByWeekdayResponse,
  AfterHoursDetailRow,
  AfterHoursSummary,
  AfterHoursTechnicianClientResponse,
  AfterHoursWeekdayHourResponse,
  ConfidenceDistributionResponse
} from "@/types/after-hours";

const PAGE_SIZE = 20;

// Fija los tokens --nx-* claros de forma explícita en vez de heredar
// prefers-color-scheme del sistema - mismo mecanismo que
// components/dashboard/DashboardShell.tsx (docs/design-revolution ancla
// sus mockups al tema claro, no define variante oscura de esta paleta).
const SHELL_STYLE = { background: "var(--nx-page-bg)", boxShadow: "var(--nx-shadow-shell)" } as React.CSSProperties;

// Predicados "vacío" - definidos a nivel de módulo (nunca inline en el
// render) para que useAfterHoursSection() no dispare un refetch espurio
// por recibir una identidad de función distinta en cada render.
function isByDimensionEmpty(body: { rows: AfterHoursByDimensionRow[] }): boolean {
  return body.rows.length === 0;
}
function isSummaryEmpty(body: AfterHoursSummary): boolean {
  return body.total_tasks === 0;
}
function isConfidenceDistributionEmpty(body: ConfidenceDistributionResponse): boolean {
  return body.rows.every(r => r.task_count === 0) && body.noneWithoutScore === 0;
}
function isDetailEmpty(body: { rows: AfterHoursDetailRow[] }): boolean {
  return body.rows.length === 0;
}

interface DetailResponse {
  rows: AfterHoursDetailRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

function formatRangeLabel(filters: AfterHoursFilterState): string {
  if (!filters.from && !filters.to) return "Todo el historial disponible";
  const fmt = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  if (filters.from && filters.to) return `${fmt(filters.from)} – ${fmt(filters.to)}`;
  return filters.from ? `Desde ${fmt(filters.from)}` : `Hasta ${fmt(filters.to)}`;
}

// Orquestador de /dashboard/after-hours (ETAPA 6.6D) - reconstrucción
// fiel de docs/design-revolution/Claude-Designs/
// Nexus - Trabajo Fuera de Horario.dc.html sobre datos reales de ETAPA
// 6.6C, completada en ETAPA 6.6D con día de la semana / cruce día×hora /
// técnico×cliente. El sidebar vive en components/layout/AppShell.tsx
// (global, no se duplica acá) - este componente solo reproduce el ÁREA DE
// CONTENIDO del prototipo (franja blanca de header + cuerpo con padding),
// igual que components/dashboard/DashboardShell.tsx hace para
// /dashboard/operacional.
//
// Cada bloque tiene su PROPIO ciclo de fetch (useAfterHoursSection) en vez
// de un Promise.all/allSettled compartido: una sección que falla nunca
// bloquea a las demás, cada una permite reintento local, y ninguna puede
// aplicar una respuesta obsoleta tras un cambio de filtro (ver
// lib/use-after-hours-section.ts).
export function AfterHoursShell() {
  const [filters, setFilters] = useState<AfterHoursFilterState>(EMPTY_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  const [detailPage, setDetailPage] = useState(1);
  const [sortBy, setSortBy] = useState<DetailSortColumn>("start_time");
  const [sortDir, setSortDir] = useState<DetailSortDir>("desc");
  const [selectedRow, setSelectedRow] = useState<AfterHoursDetailRow | null>(null);
  // Buscador de N.º de reporte (encabezado de AfterHoursDetailTable) -
  // número YA validado y aplicado (AfterHoursDetailTable.tsx valida el
  // texto crudo antes de llamar a handleReportIdFilterChange). Vive acá,
  // no en AfterHoursFilterState: solo afecta detailQuery (vía extra.reportId
  // más abajo), nunca filtersQuery - no es un filtro general de la página.
  const [reportIdFilter, setReportIdFilter] = useState<number | null>(null);

  const filtersQuery = useMemo(() => buildAfterHoursQuery(filters), [filters]);
  const detailQuery = useMemo(
    () => buildAfterHoursQuery(filters, { page: detailPage, pageSize: PAGE_SIZE, sortBy, sortDir, reportId: reportIdFilter ?? undefined }),
    [filters, detailPage, sortBy, sortDir, reportIdFilter]
  );

  const summary = useAfterHoursSection<AfterHoursSummary>("/api/dashboard/after-hours/summary", filtersQuery, isSummaryEmpty);
  const byPeriod = useAfterHoursSection<{ rows: AfterHoursByDimensionRow[] }>("/api/dashboard/after-hours/by-period", filtersQuery, isByDimensionEmpty);
  const byTechnician = useAfterHoursSection<{ rows: AfterHoursByDimensionRow[] }>("/api/dashboard/after-hours/by-technician", filtersQuery, isByDimensionEmpty);
  const byClient = useAfterHoursSection<{ rows: AfterHoursByDimensionRow[] }>("/api/dashboard/after-hours/by-client", filtersQuery, isByDimensionEmpty);
  const byTaskType = useAfterHoursSection<{ rows: AfterHoursByDimensionRow[] }>("/api/dashboard/after-hours/by-task-type", filtersQuery, isByDimensionEmpty);
  const confidenceDistribution = useAfterHoursSection<ConfidenceDistributionResponse>(
    "/api/dashboard/after-hours/confidence-distribution",
    filtersQuery,
    isConfidenceDistributionEmpty
  );
  const byWeekday = useAfterHoursSection<AfterHoursByWeekdayResponse>("/api/dashboard/after-hours/by-weekday", filtersQuery, isWeekdayResponseEmpty);
  const weekdayHour = useAfterHoursSection<AfterHoursWeekdayHourResponse>("/api/dashboard/after-hours/weekday-hour", filtersQuery, isWeekdayHourResponseEmpty);
  const technicianClient = useAfterHoursSection<AfterHoursTechnicianClientResponse>(
    "/api/dashboard/after-hours/technician-client",
    filtersQuery,
    isTechnicianClientResponseEmpty
  );
  const detail = useAfterHoursSection<DetailResponse>("/api/dashboard/after-hours/detail", detailQuery, isDetailEmpty);

  const rangeLabel = useMemo(() => formatRangeLabel(filters), [filters]);

  // Sección 14 del encargo NEXUS V3 After-Hours - misma identidad
  // (fieldbeat_task_id) que ya usa React key/el título del drawer canónico/
  // el Explorador. reportId conduce el fetch del drawer canónico
  // (FieldbeatReportDetailDrawer -> /api/dashboard/fieldbeat/reports/[id]) -
  // afterHoursContext SOLO aporta los campos temporales/contractuales
  // propios de After-Hours desde la fila YA cargada por la tabla (cero
  // fetch adicional para esa parte).
  const reportId = selectedRow ? String(selectedRow.fieldbeat_task_id) : null;

  function handleFiltersChange(next: AfterHoursFilterState) {
    setFilters(next);
    setDetailPage(1);
  }

  // Al aplicar o limpiar el buscador de reporte, siempre vuelve a página 1
  // (mismo criterio que el resto de los cambios de filtro de esta pantalla)
  // y conserva sortBy/sortDir/filters intactos - reportIdFilter es
  // ortogonal a ellos, se combina con AND en el backend (ver
  // buildReportIdCondition), nunca los reemplaza.
  function handleReportIdFilterChange(reportId: number | null) {
    setReportIdFilter(reportId);
    setDetailPage(1);
  }

  function handleSortChange(column: DetailSortColumn) {
    if (column === sortBy) {
      setSortDir(dir => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  }

  // Toggle simple (técnico/cliente/tipo de tarea/día de la semana) - mismo
  // idioma que OperationalDashboardTab.tsx::toggleFilter: click de nuevo
  // sobre el mismo valor lo quita.
  function toggleSimple<K extends keyof AfterHoursFilterState>(key: K, value: AfterHoursFilterState[K]) {
    setFilters(prev => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
    setDetailPage(1);
  }

  function handleWeekdaySelect(row: AfterHoursByDimensionRow) {
    toggleSimple("weekday", Number(row.key));
  }

  // Selección compuesta día+hora (heatmap) - una sola acción aplica o
  // limpia AMBOS campos a la vez, porque `hour` solo existe en esta UI
  // como resultado de esta interacción.
  function handleHeatmapSelect(weekday: number, hour: number) {
    setFilters(prev => (prev.weekday === weekday && prev.hour === hour ? { ...prev, weekday: undefined, hour: undefined } : { ...prev, weekday, hour }));
    setDetailPage(1);
  }
  function handleHeatmapClear() {
    setFilters(prev => ({ ...prev, weekday: undefined, hour: undefined }));
    setDetailPage(1);
  }

  // Selección compuesta técnico+cliente (par del ranking) - ambos se
  // aplican/limpian juntos con esta interacción específica, pero technician
  // y client SIGUEN siendo dos filtros independientes en el resto de la UI
  // (no se fusiona un chip global único - ver AfterHoursFilters).
  function handleTechnicianClientSelect(row: AfterHoursByDimensionRow) {
    setFilters(prev =>
      prev.technician === row.key && prev.client === (row.extra ?? undefined)
        ? { ...prev, technician: undefined, client: undefined }
        : { ...prev, technician: row.key, client: row.extra ?? undefined }
    );
    setDetailPage(1);
  }

  return (
    <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={SHELL_STYLE}>
      <div className="p-5 sm:p-7" style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}>
        <AfterHoursHeader rangeLabel={rangeLabel} />
      </div>

      <div className="p-4 sm:p-7">
        <AfterHoursBanner
          fallbackTasks={summary.data?.fallback_tasks ?? 0}
          calculableTasks={summary.data?.calculable_tasks ?? 0}
          totalTasks={summary.data?.total_tasks ?? 0}
        />

        <div className="mb-4.5">
          <AfterHoursFilters
            filters={filters}
            onChange={handleFiltersChange}
            onClear={() => {
              setFilters(EMPTY_FILTERS);
              setDetailPage(1);
            }}
            filterOptions={summary.data?.filterOptions ?? null}
            technicianOptions={byTechnician.data?.rows ?? null}
            clientOptions={byClient.data?.rows ?? null}
            moreFiltersOpen={moreFiltersOpen}
            onToggleMoreFilters={() => setMoreFiltersOpen(v => !v)}
          />
        </div>

        {summary.status === "error" ? (
          <div className="mb-6">
            <AfterHoursEmptyBlock tone="error" title="No se pudieron cargar los indicadores" description={summary.error ?? "Intenta nuevamente en unos minutos."} onRetry={summary.retry} />
          </div>
        ) : summary.data ? (
          <AfterHoursKpiSection summary={summary.data} />
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[86px] rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }} />
            ))}
          </div>
        )}

        <div className="mb-4">
          <AfterHoursEvolutionChart rows={byPeriod.data?.rows ?? []} status={byPeriod.status} error={byPeriod.error} onRetry={byPeriod.retry} />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.2fr]">
          <AfterHoursWeekdayChart
            rows={byWeekday.data?.rows ?? []}
            status={byWeekday.status}
            error={byWeekday.error}
            onRetry={byWeekday.retry}
            onSelect={handleWeekdaySelect}
            selectedWeekday={filters.weekday ?? null}
          />
          <AfterHoursWeekdayHourHeatmap
            cells={weekdayHour.data?.cells ?? []}
            status={weekdayHour.status}
            error={weekdayHour.error}
            onRetry={weekdayHour.retry}
            onSelect={handleHeatmapSelect}
            onClear={handleHeatmapClear}
            selectedWeekday={filters.weekday ?? null}
            selectedHour={filters.hour ?? null}
          />
        </div>

        <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
          Técnicos y clientes
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <AfterHoursRankingCard
            question="¿Qué técnicos responsables registran más actividad?"
            subtitle={summary.data ? `${summary.data.distinct_technicians} responsables principales identificados` : "Cargando…"}
            rows={byTechnician.data?.rows ?? []}
            status={byTechnician.status}
            error={byTechnician.error}
            onRetry={byTechnician.retry}
            onSelect={row => toggleSimple("technician", row.key)}
            selectedKey={filters.technician ?? null}
          />
          <AfterHoursRankingCard
            question="¿Qué clientes concentran más actividad?"
            subtitle={summary.data ? `${summary.data.distinct_clients} clientes identificados` : "Cargando…"}
            rows={byClient.data?.rows ?? []}
            status={byClient.status}
            error={byClient.error}
            onRetry={byClient.retry}
            onSelect={row => toggleSimple("client", row.key)}
            selectedKey={filters.client ?? null}
          />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <AfterHoursRankingCard
            question="¿Qué tipos de tarea predominan?"
            subtitle={summary.data ? `${summary.data.filterOptions.tiposTarea.length} categorías confirmadas` : "Cargando…"}
            rows={byTaskType.data?.rows ?? []}
            status={byTaskType.status}
            error={byTaskType.error}
            onRetry={byTaskType.retry}
            onSelect={row => toggleSimple("taskType", row.key)}
            selectedKey={filters.taskType ?? null}
          />
          <AfterHoursTechnicianClientCard
            data={technicianClient.data}
            status={technicianClient.status}
            error={technicianClient.error}
            onRetry={technicianClient.retry}
            onSelect={handleTechnicianClientSelect}
            selectedTechnician={filters.technician ?? null}
            selectedClient={filters.client ?? null}
          />
        </div>

        <div className="mb-4">
          {confidenceDistribution.status === "error" ? (
            <AfterHoursEmptyBlock tone="error" title="No se pudo cargar la sección de confianza" description={confidenceDistribution.error ?? "Intenta nuevamente en unos minutos."} onRetry={confidenceDistribution.retry} />
          ) : summary.data ? (
            <AfterHoursConfidenceSection summary={summary.data} distribution={confidenceDistribution.data} />
          ) : (
            <div className="h-[260px] rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }} />
          )}
        </div>

        <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
          Detalle
        </div>
        <AfterHoursDetailTable
          rows={detail.data?.rows ?? []}
          loading={detail.status === "loading"}
          error={detail.status === "error" ? (detail.error ?? "Error desconocido") : null}
          page={detailPage}
          pageSize={PAGE_SIZE}
          totalRows={detail.data?.totalRows ?? 0}
          totalPages={detail.data?.totalPages ?? 1}
          onPageChange={setDetailPage}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onRowClick={setSelectedRow}
          selectedTaskId={selectedRow?.fieldbeat_task_id ?? null}
          reportIdFilter={reportIdFilter}
          onReportIdFilterChange={handleReportIdFilterChange}
        />
      </div>

      {/* Sección 14 del encargo NEXUS V3 After-Hours - reutiliza EL MISMO
          drawer canónico que Explorador/Búsqueda/FieldBeat Calidad, nunca
          un segundo sistema de detalle de reportes (ver AfterHoursDrawer.tsx,
          eliminado). explorerHref usa la MISMA identidad (key=fieldbeat_task_id)
          que ExplorerShell.tsx ya lee de la URL para el resto de las
          entidades - ver Sección 14.6 del encargo. */}
      <FieldbeatReportDetailDrawer
        reportId={reportId}
        onClose={() => setSelectedRow(null)}
        afterHoursContext={selectedRow ? buildAfterHoursDrawerContext(selectedRow) : null}
        explorerHref={reportId ? `/explorer?entity=reports&key=${reportId}` : undefined}
      />
    </div>
  );
}
