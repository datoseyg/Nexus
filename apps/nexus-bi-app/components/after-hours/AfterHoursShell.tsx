"use client";

import { useEffect, useMemo, useState } from "react";
import { AfterHoursHeader } from "./AfterHoursHeader";
import { AfterHoursBanner } from "./AfterHoursBanner";
import { AfterHoursFilters, EMPTY_FILTERS, type AfterHoursFilterState } from "./AfterHoursFilters";
import { AfterHoursKpiSection } from "./AfterHoursKpiSection";
import { AfterHoursEvolutionChart } from "./AfterHoursEvolutionChart";
import { AfterHoursRankingCard } from "./AfterHoursRankingCard";
import { AfterHoursNotYetAvailable } from "./AfterHoursNotYetAvailable";
import { AfterHoursConfidenceSection } from "./AfterHoursConfidenceSection";
import { AfterHoursDetailTable, type DetailSortColumn, type DetailSortDir } from "./AfterHoursDetailTable";
import { AfterHoursDrawer } from "./AfterHoursDrawer";
import type {
  AfterHoursByDimensionRow,
  AfterHoursDetailRow,
  AfterHoursSummary,
  ConfidenceDistributionResponse
} from "@/types/after-hours";

const PAGE_SIZE = 20;

// Fija los tokens --nx-* claros de forma explícita en vez de heredar
// prefers-color-scheme del sistema - mismo mecanismo que
// components/dashboard/DashboardShell.tsx (docs/design-revolution ancla
// sus mockups al tema claro, no define variante oscura de esta paleta).
const SHELL_STYLE = { background: "var(--nx-page-bg)", boxShadow: "var(--nx-shadow-shell)" } as React.CSSProperties;

function toQuery(filters: AfterHoursFilterState, extra: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  const entries: Record<string, string | undefined> = {
    client: filters.client,
    technician: filters.technician,
    taskType: filters.taskType,
    from: filters.from,
    to: filters.to,
    dataBasis: filters.dataBasis,
    confidenceLevel: filters.confidenceLevel,
    onlyAfterHours: filters.onlyAfterHours ? "true" : undefined,
    onlyLowConfidence: filters.onlyLowConfidence ? "true" : undefined,
    fallbackUsed: filters.fallbackUsed ? "true" : undefined,
    coverageReasonCode: filters.coverageReasonCode,
    contractualReasonCode: filters.contractualReasonCode
  };
  for (const [key, value] of Object.entries(entries)) if (value) search.set(key, value);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
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
// 6.6C. El sidebar vive en components/layout/AppShell.tsx (global, no se
// duplica acá) - este componente solo reproduce el ÁREA DE CONTENIDO del
// prototipo (franja blanca de header + cuerpo con padding), igual que
// components/dashboard/DashboardShell.tsx hace para /dashboard/operacional.
export function AfterHoursShell() {
  const [filters, setFilters] = useState<AfterHoursFilterState>(EMPTY_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  const [summary, setSummary] = useState<AfterHoursSummary | null>(null);
  const [byPeriod, setByPeriod] = useState<AfterHoursByDimensionRow[]>([]);
  const [byTechnician, setByTechnician] = useState<AfterHoursByDimensionRow[]>([]);
  const [byClient, setByClient] = useState<AfterHoursByDimensionRow[]>([]);
  const [byTaskType, setByTaskType] = useState<AfterHoursByDimensionRow[]>([]);
  const [confidenceDistribution, setConfidenceDistribution] = useState<ConfidenceDistributionResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [detailRows, setDetailRows] = useState<AfterHoursDetailRow[]>([]);
  const [detailPage, setDetailPage] = useState(1);
  const [detailTotalPages, setDetailTotalPages] = useState(1);
  const [detailTotalRows, setDetailTotalRows] = useState(0);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<DetailSortColumn>("start_time");
  const [sortDir, setSortDir] = useState<DetailSortDir>("desc");

  const [selectedRow, setSelectedRow] = useState<AfterHoursDetailRow | null>(null);

  useEffect(() => {
    setDetailPage(1);
  }, [filters]);

  useEffect(() => {
    const query = toQuery(filters);
    setSummaryLoading(true);

    Promise.all([
      fetch(`/api/dashboard/after-hours/summary?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-period?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-technician?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-client?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/by-task-type?${query}`).then(res => res.json()),
      fetch(`/api/dashboard/after-hours/confidence-distribution?${query}`).then(res => res.json())
    ])
      .then(([summaryBody, periodBody, technicianBody, clientBody, taskTypeBody, confidenceBody]) => {
        setSummary(summaryBody);
        setByPeriod(periodBody.rows ?? []);
        setByTechnician(technicianBody.rows ?? []);
        setByClient(clientBody.rows ?? []);
        setByTaskType(taskTypeBody.rows ?? []);
        setConfidenceDistribution(confidenceBody);
      })
      .finally(() => setSummaryLoading(false));
  }, [filters]);

  useEffect(() => {
    const query = toQuery(filters, { page: detailPage, pageSize: PAGE_SIZE, sortBy, sortDir });
    setDetailLoading(true);
    setDetailError(null);

    fetch(`/api/dashboard/after-hours/detail?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setDetailRows(body.rows ?? []);
        setDetailTotalPages(body.totalPages ?? 1);
        setDetailTotalRows(body.totalRows ?? 0);
      })
      .catch(body => setDetailError(body?.error ?? "Error desconocido"))
      .finally(() => setDetailLoading(false));
  }, [filters, detailPage, sortBy, sortDir]);

  const rangeLabel = useMemo(() => formatRangeLabel(filters), [filters]);

  function handleSortChange(column: DetailSortColumn) {
    if (column === sortBy) {
      setSortDir(dir => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  }

  return (
    <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={SHELL_STYLE}>
      <div className="p-5 sm:p-7" style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}>
        <AfterHoursHeader rangeLabel={rangeLabel} />
      </div>

      <div className="p-4 sm:p-7">
        <AfterHoursBanner fallbackTasks={summary?.fallback_tasks ?? 0} calculableTasks={summary?.calculable_tasks ?? 0} />

        <div className="mb-4.5">
          <AfterHoursFilters
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
            filterOptions={summary?.filterOptions ?? null}
            moreFiltersOpen={moreFiltersOpen}
            onToggleMoreFilters={() => setMoreFiltersOpen(v => !v)}
          />
        </div>

        {summary && !summaryLoading ? (
          <AfterHoursKpiSection summary={summary} />
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[86px] rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }} />
            ))}
          </div>
        )}

        <div className="mb-4">
          <AfterHoursEvolutionChart rows={byPeriod} />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.2fr]">
          <AfterHoursNotYetAvailable
            question="¿Qué días concentran más actividad?"
            subtitle="Distribución por día de la semana"
            reason="Requiere una futura API con agregación por día de la semana - no implementada en ETAPA 6.6C."
          />
          <AfterHoursNotYetAvailable
            question="¿En qué días y horas se concentra?"
            subtitle="Cruce de día y hora"
            reason="Requiere una futura API con agregación por día y hora - no implementada en ETAPA 6.6C."
          />
        </div>

        <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
          Técnicos y clientes
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <AfterHoursRankingCard
            question="¿Qué técnicos registran más actividad?"
            subtitle={summary ? `${summary.filterOptions.tecnicos.length} técnicos identificados` : "Cargando…"}
            rows={byTechnician}
          />
          <AfterHoursRankingCard
            question="¿Qué clientes concentran más actividad?"
            subtitle={summary ? `${summary.filterOptions.clientes.length} clientes identificados` : "Cargando…"}
            rows={byClient}
          />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <AfterHoursRankingCard
            question="¿Qué tipos de tarea predominan?"
            subtitle={summary ? `${summary.filterOptions.tiposTarea.length} categorías confirmadas` : "Cargando…"}
            rows={byTaskType}
          />
          <AfterHoursNotYetAvailable
            question="¿Cómo se relacionan técnicos y clientes?"
            subtitle="Actividad cruzada"
            reason="Requiere una futura API de agregación técnico×cliente - hoy exigiría una llamada por fila, fuera de alcance de esta etapa."
          />
        </div>

        <div className="mb-4">
          {summary ? (
            <AfterHoursConfidenceSection summary={summary} distribution={confidenceDistribution} />
          ) : (
            <div className="h-[260px] rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }} />
          )}
        </div>

        <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
          Detalle
        </div>
        <AfterHoursDetailTable
          rows={detailRows}
          loading={detailLoading}
          error={detailError}
          page={detailPage}
          pageSize={PAGE_SIZE}
          totalRows={detailTotalRows}
          totalPages={detailTotalPages}
          onPageChange={setDetailPage}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          onRowClick={setSelectedRow}
        />
      </div>

      <AfterHoursDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
