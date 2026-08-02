"use client";

import "@/lib/chartjs-setup";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, Doughnut, Line, Pie } from "react-chartjs-2";
import type { ChartEvent, ActiveElement } from "chart.js";
import { FilterBar, type FilterConfig } from "./FilterBar";
import { KpiCard } from "./KpiCard";
import { ChartCard } from "./ChartCard";
import { DataTableCard, type DataTableColumn } from "./DataTableCard";
import { MiniBarTableCell } from "./MiniBarTableCell";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";
import { FilterChips, type FilterChipItem } from "./FilterChips";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useDataRefreshEpoch } from "@/components/data-refresh/DataRefreshEpochProvider";
import type { Grain } from "@/lib/dashboard-filters";
import {
  DASHBOARD_PALETTE,
  DASHBOARD_PALETTE_SEQUENCE,
  formatDateTimeEsCl,
  formatNumberEsCl,
  formatPercent,
  formatPeriodLabel,
  highlightColors,
  withAlpha
} from "@/lib/dashboard-formatters";

interface FilterOptions {
  clientes: string[];
  tiposTarea: string[];
  maquinas: string[];
  estadosTicket: string[];
  dateRange: {
    reportCentric: { min: string | null; max: string | null };
    ticketCentric: { min: string | null; max: string | null };
  };
  bodegas: { available: boolean; values: string[]; note: string };
  origenRegistro: { available: boolean; values: string[]; note: string };
}

interface FiltersState {
  from?: string;
  to?: string;
  grain: Grain;
  cliente?: string;
  tipoTarea?: string;
  maquina?: string;
  sku?: string;
  bodega?: string;
  estadoTicket?: string;
  origenRegistro?: string;
  reportQuality?: string;
}

const FILTER_KEYS: Array<keyof FiltersState> = [
  "cliente",
  "tipoTarea",
  "maquina",
  "sku",
  "bodega",
  "estadoTicket",
  "origenRegistro",
  "reportQuality"
];

const FILTER_LABELS: Record<string, string> = {
  cliente: "Cliente",
  tipoTarea: "Tipo de Tarea",
  maquina: "Máquina",
  sku: "SKU",
  bodega: "Bodega",
  estadoTicket: "Estado Ticket",
  origenRegistro: "Origen Registro",
  reportQuality: "Estado General"
};

interface SummaryData {
  kpis: {
    totalRegistros: number;
    totalTickets: number;
    repuestosUsados: number;
    pctConTicketReportado: number;
    pctConTicketAccesible: number;
    ultimoCliente: string | null;
  };
  estados: Array<{ estado: string; cantidad: number }>;
  evolucion: Array<{ periodo: string; cantidad: number }>;
  bodegasClientes: { available: boolean; values: Array<{ cliente: string; cantidad: number; pct: number }> };
  rankingBodegas: { available: boolean; values: Array<{ bodega: string; cantidad: number; pct: number }> };
  ticketsCliente: Array<{ cliente: string; total: number; conTicketReportado: number; accesibles: number; pct: number }>;
  estadoGeneral: Array<{ estado: string; cantidad: number }>;
  maquinasClientes: { clientes: string[]; maquinas: string[]; series: Array<{ maquina: string; data: number[] }> };
}

interface PartsRow {
  sku_dolibarr: string;
  nombre_repuesto: string | null;
  cantidad_consumida: number;
  reportes_asociados: number;
  clientes_asociados: number;
  match_methods: string;
}

interface DetailRow {
  fieldbeat_task_date: string;
  fieldbeat_task_id: number;
  client_name: string;
  linked_zendesk_ticket_id: string | null;
  equipment_internal_ids: string;
  used_part_numbers: string | null;
  task_type: string;
  used_parts_count: number;
  origen: string;
}

interface DonutEntry {
  label: string;
  value: number;
  color: string;
}

// Panel reutilizable para los 3 donuts/pie de esta pantalla (corrección
// visual, 2ª pasada). El bug original: el overlay del total central se
// posicionaba `absolute inset-0` respecto de TODA la tarjeta (que también
// contenía la leyenda de Chart.js dibujada dentro del mismo canvas), así
// que el centro real del anillo quedaba desplazado por el espacio que la
// leyenda le robaba al canvas. Acá el canvas SIEMPRE ocupa una caja
// cuadrada propia (`relative`, mismas dimensiones en alto y ancho) sin
// leyenda interna de Chart.js (`legend.display:false` en cada chart) - el
// overlay `absolute inset-0` sobre esa misma caja queda entonces
// exactamente centrado en el anillo. La leyenda real vive fuera, como
// lista HTML (≥12px, con wrapping, clickeable para preservar el
// cross-filter existente).
function DonutPanel({
  entries,
  centerLabel,
  centerSubLabel,
  onEntryClick,
  children
}: {
  entries: DonutEntry[];
  centerLabel?: string;
  centerSubLabel?: string;
  onEntryClick?: (label: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-[clamp(240px,26vw,300px)] w-[clamp(240px,26vw,300px)] shrink-0">
        <div className="absolute inset-0">{children}</div>
        {centerLabel && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-extrabold [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
              {centerLabel}
            </span>
            {centerSubLabel && (
              <span className="text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
                {centerSubLabel}
              </span>
            )}
          </div>
        )}
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-2">
        {entries.map(entry => (
          <li key={entry.label} className="min-w-0">
            {onEntryClick ? (
              <button
                type="button"
                onClick={() => onEntryClick(entry.label)}
                className="flex w-full items-center gap-2 rounded text-left text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
                style={{ color: "var(--nx-text-secondary)" }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: entry.color }} aria-hidden="true" />
                <span className="min-w-0 break-words">
                  {entry.label} -{formatNumberEsCl(entry.value)}
                </span>
              </button>
            ) : (
              <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: entry.color }} aria-hidden="true" />
                <span className="min-w-0 break-words">
                  {entry.label} -{formatNumberEsCl(entry.value)}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function parseFiltersFromLocation(): FiltersState {
  if (typeof window === "undefined") return { grain: "month" };
  const sp = new URLSearchParams(window.location.search);
  const grain = sp.get("grain");
  return {
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    grain: grain === "day" || grain === "week" || grain === "month" ? grain : "month",
    cliente: sp.get("cliente") || undefined,
    tipoTarea: sp.get("tipoTarea") || undefined,
    maquina: sp.get("maquina") || undefined,
    sku: sp.get("sku") || undefined,
    bodega: sp.get("bodega") || undefined,
    estadoTicket: sp.get("estadoTicket") || undefined,
    origenRegistro: sp.get("origenRegistro") || undefined,
    reportQuality: sp.get("reportQuality") || undefined
  };
}

function toQueryString(filters: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function firstClickedLabel(elements: ActiveElement[], labels: string[]): string | null {
  if (!elements.length) return null;
  return labels[elements[0].index] ?? null;
}

const SECTION_LABEL_CLASS = "mb-2.5 text-[13px] font-bold uppercase tracking-wide";
const SECTION_LABEL_STYLE: React.CSSProperties = { color: "var(--nx-text-secondary)" };

export function OperationalDashboardTab() {
  const epoch = useDataRefreshEpoch();
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<FiltersState>(() => parseFiltersFromLocation());
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [partsPage, setPartsPage] = useState(1);
  const [parts, setParts] = useState<{ rows: PartsRow[]; page: number; totalPages: number; totalRows: number } | null>(null);

  const [detailPage, setDetailPage] = useState(1);
  const [idTarea, setIdTarea] = useState("");
  const [idTicket, setIdTicket] = useState("");
  const [detail, setDetail] = useState<{ rows: DetailRow[]; page: number; totalPages: number; totalRows: number } | null>(null);

  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/operacional/filters")
      .then(res => res.json())
      .then(setFilterOptions)
      .catch(() => setFilterOptions(null));
  }, []);

  // Sincroniza el estado de filtros con la URL (?from=&to=&cliente=&...)
  // para que sea compartible - ver docs/DASHBOARD_VISUAL_STYLE.md.
  useEffect(() => {
    const query = toQueryString(filters as unknown as Record<string, string | undefined>);
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = toQueryString(filters as unknown as Record<string, string | undefined>);
    fetch(`/api/dashboard/operacional/summary${query ? `?${query}` : ""}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setSummary(body);
      })
      .catch(body => setError({ message: body?.error ?? "Error desconocido", code: body?.code }))
      .finally(() => setLoading(false));
  }, [filters, epoch]);

  useEffect(() => {
    const query = toQueryString({ page: String(partsPage), pageSize: "10", ...(filters as unknown as Record<string, string | undefined>) });
    fetch(`/api/dashboard/operacional/parts?${query}`)
      .then(res => res.json())
      .then(setParts)
      .catch(() => setParts(null));
  }, [partsPage, filters, epoch]);

  useEffect(() => {
    const query = toQueryString({
      page: String(detailPage),
      pageSize: "5",
      idTarea,
      idTicket,
      ...(filters as unknown as Record<string, string | undefined>)
    });
    fetch(`/api/dashboard/operacional/detail?${query}`)
      .then(res => res.json())
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [detailPage, idTarea, idTicket, filters, epoch]);

  const resetPages = useCallback(() => {
    setPartsPage(1);
    setDetailPage(1);
  }, []);

  function handleFilterChange(key: string, value: string) {
    setFilters(prev => ({ ...prev, [key]: value || undefined }));
    resetPages();
  }

  // Cross-filter: click en un gráfico (o en su leyenda HTML) agrega/actualiza
  // el filtro global correspondiente (toggle: click de nuevo sobre la misma
  // categoría lo quita) - ver docs/DASHBOARD_VISUAL_STYLE.md § Cross-filter.
  const toggleFilter = useCallback(
    (key: keyof FiltersState, value: string | null) => {
      if (!value) return;
      setFilters(prev => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
      resetPages();
    },
    [resetPages]
  );

  function handleDateRangeChange(value: DateRangeValue) {
    setFilters(prev => ({ ...prev, from: value.from, to: value.to, grain: value.grain }));
    resetPages();
  }

  function handleClearFilters() {
    setFilters({ grain: "month" });
    setIdTarea("");
    setIdTicket("");
    resetPages();
  }

  function handleDownloadReport() {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dashboard-operacional-resumen.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const filterConfigs: FilterConfig[] = useMemo(() => {
    if (!filterOptions) return [];

    return [
      { type: "select", key: "cliente", placeholder: "Cliente", options: filterOptions.clientes },
      { type: "select", key: "maquina", placeholder: "Máquina", options: filterOptions.maquinas },
      { type: "select", key: "tipoTarea", placeholder: "Tipo de Tarea", options: filterOptions.tiposTarea },
      { type: "select", key: "estadoTicket", placeholder: "Estado Ticket", options: filterOptions.estadosTicket },
      {
        type: "select",
        key: "origenRegistro",
        placeholder: "Origen Registro",
        options: filterOptions.origenRegistro.values,
        disabled: !filterOptions.origenRegistro.available,
        disabledReason: filterOptions.origenRegistro.note
      },
      {
        type: "select",
        key: "bodega",
        placeholder: "Bodega",
        options: filterOptions.bodegas.values,
        disabled: !filterOptions.bodegas.available,
        disabledReason: filterOptions.bodegas.note
      }
    ];
  }, [filterOptions]);

  const chips: FilterChipItem[] = useMemo(() => {
    const items: FilterChipItem[] = [];
    if (filters.from || filters.to) {
      items.push({ key: "periodo", label: "Período", value: `${filters.from ?? "…"} → ${filters.to ?? "…"}` });
    }
    for (const key of FILTER_KEYS) {
      const value = filters[key];
      if (value) items.push({ key, label: FILTER_LABELS[key], value });
    }
    return items;
  }, [filters]);

  function handleRemoveChip(key: string) {
    if (key === "periodo") {
      setFilters(prev => ({ ...prev, from: undefined, to: undefined }));
    } else {
      setFilters(prev => ({ ...prev, [key]: undefined }));
    }
    resetPages();
  }

  if (loading && !summary) {
    return (
      <p aria-busy="true" style={{ color: "var(--nx-text-secondary)" }}>
        Cargando dashboard operacional…
      </p>
    );
  }

  if (error) {
    return (
      <div role="alert">
        <ErrorBanner message={error.message} code={error.code} />
      </div>
    );
  }

  if (!summary) return null;

  const partsColumns: DataTableColumn<PartsRow>[] = [
    { key: "info", label: "Info.", render: (_row, i) => `${((parts?.page ?? 1) - 1) * 10 + i + 1}.` },
    { key: "sku", label: "SKU Dolibarr", render: row => row.sku_dolibarr },
    { key: "nombre", label: "Nombre Repuesto", render: row => row.nombre_repuesto || "-", wrap: true, minWidthPx: 200 },
    { key: "reportes", label: "Reportes", render: row => formatNumberEsCl(row.reportes_asociados) },
    { key: "clientes", label: "Clientes", render: row => formatNumberEsCl(row.clientes_asociados) },
    {
      key: "cantidad",
      label: "Cantidad Consumida",
      render: row => <MiniBarTableCell value={row.cantidad_consumida} max={parts?.rows[0]?.cantidad_consumida ?? row.cantidad_consumida} />
    }
  ];

  const detailColumns: DataTableColumn<DetailRow>[] = [
    { key: "fecha", label: "Fecha y Hora de Finalización", render: row => formatDateTimeEsCl(row.fieldbeat_task_date), wrap: true, minWidthPx: 160 },
    { key: "origen", label: "Origen", render: row => row.origen, minWidthPx: 90 },
    { key: "idTarea", label: "ID Tarea Fieldbeat", render: row => row.fieldbeat_task_id, wrap: true, minWidthPx: 110 },
    { key: "cliente", label: "Cliente", render: row => row.client_name, wrap: true, minWidthPx: 190 },
    { key: "idTicket", label: "ID Ticket", render: row => row.linked_zendesk_ticket_id || "-", minWidthPx: 100 },
    { key: "maquina", label: "Máquina", render: row => row.equipment_internal_ids || "-", wrap: true, minWidthPx: 160 },
    // Sin repuesto -> "-"; repuesto no identificado con consumo real ->
    // "No identificado" (nunca "-" + cantidad 0 a la vez para una fila que
    // sí tiene consumo, ver §12 del encargo de ETAPA 4).
    {
      key: "skuLink",
      label: "SKU",
      render: row => {
        if (row.used_parts_count === 0) return "-";
        return row.used_part_numbers || "No identificado";
      },
      breakWord: true,
      minWidthPx: 140
    },
    { key: "tipo", label: "Tipo de Tarea", render: row => row.task_type, wrap: true, minWidthPx: 150 },
    { key: "cantidad", label: "Cantidad Descontada", render: row => formatNumberEsCl(row.used_parts_count), wrap: true, minWidthPx: 130 }
  ];

  const estadosColors = highlightColors(summary.estados.map(e => e.estado), DASHBOARD_PALETTE_SEQUENCE, filters.estadoTicket);
  const bodegasClientesColors = highlightColors(
    summary.bodegasClientes.values.map(v => v.cliente),
    DASHBOARD_PALETTE_SEQUENCE,
    filters.cliente
  );
  const rankingBodegasColors = highlightColors(
    summary.rankingBodegas.values.map(v => v.bodega),
    DASHBOARD_PALETTE_SEQUENCE,
    filters.bodega
  );
  const estadoGeneralColors = summary.estadoGeneral.map(e =>
    !filters.reportQuality || e.estado === filters.reportQuality ? DASHBOARD_PALETTE.teal : withAlpha(DASHBOARD_PALETTE.teal, 0.25)
  );

  const bodegasClientesEntries: DonutEntry[] = summary.bodegasClientes.values.map((v, i) => ({
    label: v.cliente,
    value: v.cantidad,
    color: bodegasClientesColors[i]
  }));
  const rankingBodegasEntries: DonutEntry[] = summary.rankingBodegas.values.map((v, i) => ({
    label: v.bodega,
    value: v.cantidad,
    color: rankingBodegasColors[i]
  }));

  // "Tickets por cliente": el mismo dataset ya devuelto (ticketsCliente[])
  // se agrupa client-side en top 5 + "Otros" sobre el campo `accesibles`
  // (reportes con ticket Zendesk accesible) - es el campo que da nombre al
  // gráfico y, a diferencia de `pct` (usado antes), es un conteo real
  // sumable en un total con sentido para el centro del donut. `total`
  // (todos los reportes del cliente, tengan o no ticket) no se usa acá
  // porque mezclaría "reportes" con "tickets" bajo el mismo rótulo. Cero
  // fetches nuevos - ver ETAPA 4.0 §5 regla 5.
  const ticketsClienteSorted = [...summary.ticketsCliente].sort((a, b) => b.accesibles - a.accesibles);
  const ticketsClienteTop5 = ticketsClienteSorted.slice(0, 5);
  const ticketsClienteOtrosTotal = ticketsClienteSorted.slice(5).reduce((sum, v) => sum + v.accesibles, 0);
  const ticketsClienteEntries = [
    ...ticketsClienteTop5.map(v => ({ label: v.cliente, value: v.accesibles })),
    ...(ticketsClienteOtrosTotal > 0 ? [{ label: "Otros clientes", value: ticketsClienteOtrosTotal }] : [])
  ];
  const ticketsClienteTotal = ticketsClienteEntries.reduce((sum, e) => sum + e.value, 0);
  const ticketsClienteColors = ticketsClienteEntries.map((entry, i) =>
    entry.label === "Otros clientes" ? DASHBOARD_PALETTE.gray : DASHBOARD_PALETTE_SEQUENCE[i % DASHBOARD_PALETTE_SEQUENCE.length]
  );
  const ticketsClienteDonutEntries: DonutEntry[] = ticketsClienteEntries.map((e, i) => ({ ...e, color: ticketsClienteColors[i] }));

  const maquinasClientesTotals = summary.maquinasClientes.clientes.map((_cliente, ci) =>
    summary.maquinasClientes.series.reduce((sum, serie) => sum + (serie.data[ci] ?? 0), 0)
  );

  const complementoPctReportado = Math.max(0, 100 - summary.kpis.pctConTicketReportado);

  return (
    <>
      <div className="mb-4 min-w-0 rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="mb-2 flex items-center justify-between md:hidden">
          <span className="text-[12px] font-bold uppercase" style={{ color: "var(--nx-text-secondary)" }}>
            Filtros
          </span>
          <button
            type="button"
            className="rounded-[var(--nx-radius-button)] px-3 text-[12.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
            style={{ background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)", minHeight: 44 }}
            onClick={() => setFiltersCollapsed(v => !v)}
          >
            {filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
          </button>
        </div>

        <div className={`${filtersCollapsed ? "hidden" : "flex"} min-w-0 flex-col gap-3 md:flex`}>
          <DateRangePicker
            value={{ from: filters.from, to: filters.to, grain: filters.grain }}
            onChange={handleDateRangeChange}
            min={filterOptions?.dateRange.reportCentric.min}
            max={filterOptions?.dateRange.reportCentric.max}
          />

          <FilterChips items={chips} onRemove={handleRemoveChip} />

          <FilterBar
            filters={filterConfigs}
            values={filters as unknown as Record<string, string>}
            onChange={handleFilterChange}
            onClear={handleClearFilters}
            extra={
              <input
                type="text"
                placeholder="🔍 SKU o repuesto"
                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
                style={{
                  border: "1px solid var(--nx-border)",
                  borderRadius: "var(--nx-radius-button)",
                  color: "var(--nx-text-primary)",
                  minHeight: 44,
                  minWidth: 170,
                  padding: "0 12px",
                  fontSize: 13.5
                }}
                value={filters.sku ?? ""}
                onChange={event => handleFilterChange("sku", event.target.value)}
              />
            }
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className={SECTION_LABEL_CLASS} style={{ ...SECTION_LABEL_STYLE, marginBottom: 0 }}>
          Resumen ejecutivo
        </span>
        <button
          type="button"
          onClick={handleDownloadReport}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--nx-radius-button)] border px-4 text-[13px] font-semibold transition-colors hover:bg-[var(--nx-accent-indigo)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
          style={{ borderColor: "var(--nx-accent-indigo)", color: "var(--nx-accent-indigo)", background: "#ffffff", minHeight: 44 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0-4-4m4 4 4-4" />
            <path d="M4 19h16" />
          </svg>
          Descargar resumen (JSON)
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <KpiCard label="Total de reportes" value={formatNumberEsCl(summary.kpis.totalRegistros)} hint="servicios técnicos registrados" accentColor="var(--nx-accent-green)" />
        <KpiCard label="Total de tickets" value={formatNumberEsCl(summary.kpis.totalTickets)} hint="tickets de soporte Zendesk" accentColor="var(--nx-accent-indigo)" />
        <KpiCard label="Repuestos utilizados" value={formatNumberEsCl(summary.kpis.repuestosUsados)} hint="consumidos en reportes de servicio" accentColor="var(--nx-accent-purple)" />
      </div>

      <div className="mb-6 grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
        <KpiCard label="Último cliente con actividad" value={summary.kpis.ultimoCliente ?? "Información todavía no disponible"} compact />

        <div className="h-fit min-w-0 rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
          <p className="mb-1.5 text-[13.5px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
            Vinculación de reportes con tickets
          </p>
          <div className="mb-2 flex h-4 overflow-hidden rounded" aria-hidden="true">
            <div style={{ width: `${summary.kpis.pctConTicketReportado}%`, background: "var(--nx-accent-indigo)" }} />
            <div style={{ width: `${complementoPctReportado}%`, background: "var(--nx-border)" }} />
          </div>
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Reportes vinculados a ticket - {formatPercent(summary.kpis.pctConTicketReportado, 1)} · Sin ticket asociado - {" "}
            {formatPercent(complementoPctReportado, 1)}
          </p>
          <p className="mt-2 text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
            De los reportes vinculados, {formatPercent(summary.kpis.pctConTicketAccesible, 1)} del total corresponde a un ticket
            actualmente accesible en Zendesk.
          </p>
        </div>
      </div>

      <span className={SECTION_LABEL_CLASS} style={SECTION_LABEL_STYLE}>
        Actividad y evolución
      </span>
      <div className="mb-1 grid grid-cols-1 gap-3.5">
        <ChartCard
          title={`Evolución operativa (agrupado por ${filters.grain === "day" ? "día" : filters.grain === "week" ? "semana" : "mes"})`}
          subtitle='Reportes de servicio registrados por período - solo serie "General".'
          size="line"
          accessibleData={{
            labels: summary.evolucion.map(e => formatPeriodLabel(e.periodo)),
            values: summary.evolucion.map(e => e.cantidad),
            unitLabel: "períodos",
            valueSuffix: "reportes"
          }}
        >
          <Line
            data={{
              labels: summary.evolucion.map(e => formatPeriodLabel(e.periodo)),
              datasets: [
                {
                  label: "General",
                  data: summary.evolucion.map(e => e.cantidad),
                  borderColor: DASHBOARD_PALETTE.green,
                  backgroundColor: "transparent",
                  tension: 0.2,
                  pointRadius: 2
                }
              ]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: "bottom", labels: { font: { size: 12 } } } },
              scales: { y: { beginAtZero: true, ticks: { font: { size: 12 } } }, x: { ticks: { font: { size: 12 } } } }
            }}
          />
        </ChartCard>
      </div>
      <p className="mb-4 text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
        La serie &quot;Apoteca&quot; del dashboard de referencia se puede aproximar con el filtro &quot;Origen Registro&quot; (heurística
        basada en equipment_internal_ids) - no existe un campo de origen dedicado en este warehouse.
      </p>

      <div className="mb-1 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title="¿Cuántos tickets existen en cada estado?"
          subtitle="Cantidad de tickets Zendesk en el período seleccionado."
          size="bar"
          accessibleData={{
            labels: summary.estados.map(e => e.estado),
            values: summary.estados.map(e => e.cantidad),
            unitLabel: "estados de ticket",
            valueSuffix: "tickets"
          }}
        >
          <Bar
            data={{
              labels: summary.estados.map(e => e.estado),
              datasets: [{ data: summary.estados.map(e => e.cantidad), backgroundColor: estadosColors, borderRadius: 4, maxBarThickness: 80 }]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true, ticks: { font: { size: 12 } } }, x: { ticks: { font: { size: 12 } } } },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("estadoTicket", firstClickedLabel(elements, summary.estados.map(e => e.estado)))
            }}
          />
        </ChartCard>

        <ChartCard
          title="¿Cuál fue el resultado de los reportes?"
          subtitle={`Cantidad de reportes por resultado, de un total de ${formatNumberEsCl(summary.kpis.totalRegistros)}.`}
          size="bar"
          accessibleData={{
            labels: summary.estadoGeneral.map(e => e.estado),
            values: summary.estadoGeneral.map(e => e.cantidad),
            unitLabel: "categorías de resultado",
            valueSuffix: "reportes"
          }}
        >
          <Bar
            data={{
              labels: summary.estadoGeneral.map(e => e.estado),
              datasets: [{ data: summary.estadoGeneral.map(e => e.cantidad), backgroundColor: estadoGeneralColors }]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: "y" as const,
              plugins: { legend: { display: false } },
              scales: { x: { beginAtZero: true, ticks: { font: { size: 12 } } }, y: { ticks: { font: { size: 12 } } } },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("reportQuality", firstClickedLabel(elements, summary.estadoGeneral.map(e => e.estado)))
            }}
          />
        </ChartCard>
      </div>
      <p className="mb-6 text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
        Cerrado incluye closed + solved. Abierto incluye open + new. Pendiente agrupa pending y otros estados no cerrados. Click en una
        barra filtra el resto del dashboard por ese estado.
      </p>

      <span className={SECTION_LABEL_CLASS} style={SECTION_LABEL_STYLE}>
        Repuestos y bodegas
      </span>
      <div className="mb-6 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title="¿Desde qué bodegas se utilizan los repuestos, por cliente?"
          subtitle="Distribución calculada solo sobre repuestos con bodega de origen registrada."
          size="donut"
          available={summary.bodegasClientes.available}
          unavailableReason="Sin repuestos con bodega de origen registrada para este filtro."
          accessibleData={{
            labels: summary.bodegasClientes.values.map(v => v.cliente),
            values: summary.bodegasClientes.values.map(v => v.cantidad),
            unitLabel: "clientes con bodega registrada",
            valueSuffix: "usos"
          }}
        >
          <DonutPanel entries={bodegasClientesEntries} onEntryClick={label => toggleFilter("cliente", label)}>
            <Pie
              data={{
                labels: summary.bodegasClientes.values.map(v => v.cliente),
                datasets: [{ data: summary.bodegasClientes.values.map(v => v.cantidad), backgroundColor: bodegasClientesColors }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: ctx => {
                        const v = summary.bodegasClientes.values[ctx.dataIndex];
                        return ` ${v.cliente} - ${formatNumberEsCl(v.cantidad)} usos (${formatPercent(v.pct, 1)})`;
                      }
                    }
                  }
                },
                onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                  toggleFilter("cliente", firstClickedLabel(elements, summary.bodegasClientes.values.map(v => v.cliente)))
              }}
            />
          </DonutPanel>
        </ChartCard>

        <ChartCard
          title="Ranking de bodegas utilizadas"
          subtitle="Distribución calculada solo sobre repuestos con bodega de origen registrada (no es el total de repuestos del período)."
          size="donut"
          available={summary.rankingBodegas.available}
          unavailableReason="Sin repuestos con bodega de origen registrada para este filtro."
          accessibleData={{
            labels: summary.rankingBodegas.values.map(v => v.bodega),
            values: summary.rankingBodegas.values.map(v => v.cantidad),
            unitLabel: "bodegas registradas",
            valueSuffix: "usos"
          }}
        >
          <DonutPanel entries={rankingBodegasEntries} onEntryClick={label => toggleFilter("bodega", label)}>
            <Doughnut
              data={{
                labels: summary.rankingBodegas.values.map(v => v.bodega),
                datasets: [{ data: summary.rankingBodegas.values.map(v => v.cantidad), backgroundColor: rankingBodegasColors }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: ctx => {
                        const v = summary.rankingBodegas.values[ctx.dataIndex];
                        return ` ${v.bodega} - ${formatNumberEsCl(v.cantidad)} usos (${formatPercent(v.pct, 1)})`;
                      }
                    }
                  }
                },
                onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                  toggleFilter("bodega", firstClickedLabel(elements, summary.rankingBodegas.values.map(v => v.bodega)))
              }}
            />
          </DonutPanel>
        </ChartCard>
      </div>

      <span className={SECTION_LABEL_CLASS} style={SECTION_LABEL_STYLE}>
        Clientes y máquinas
      </span>
      <div className="mb-6 grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ChartCard
            title="¿Cómo se distribuyen los reportes con ticket accesible, por cliente?"
            subtitle={`Top 5 + "Otros", sobre ${formatNumberEsCl(ticketsClienteTotal)} reportes con ticket Zendesk accesible en el período.`}
            size="donut"
            accessibleData={{
              labels: ticketsClienteEntries.map(e => e.label),
              values: ticketsClienteEntries.map(e => e.value),
              unitLabel: "clientes",
              valueSuffix: "reportes con ticket accesible"
            }}
          >
            <DonutPanel
              entries={ticketsClienteDonutEntries}
              centerLabel={formatNumberEsCl(ticketsClienteTotal)}
              centerSubLabel="accesibles"
              onEntryClick={label => {
                if (label !== "Otros clientes") toggleFilter("cliente", label);
              }}
            >
              <Doughnut
                data={{
                  labels: ticketsClienteEntries.map(e => e.label),
                  datasets: [{ data: ticketsClienteEntries.map(e => e.value), backgroundColor: ticketsClienteColors }]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: ctx =>
                          ` ${ticketsClienteEntries[ctx.dataIndex].label} - ${formatNumberEsCl(ticketsClienteEntries[ctx.dataIndex].value)}`
                      }
                    }
                  },
                  onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                    toggleFilter("cliente", firstClickedLabel(elements, ticketsClienteEntries.map(e => e.label)))
                }}
              />
            </DonutPanel>
          </ChartCard>
        </div>

        <div className="lg:col-span-7">
          <ChartCard
            title="¿Dónde se concentra la actividad cruzada entre máquinas y clientes?"
            subtitle="Top 10 máquinas × top 8 clientes según consumo (recorte del backend, no es el universo completo)."
            size="matrix"
            accessibleData={{
              labels: summary.maquinasClientes.clientes,
              values: maquinasClientesTotals,
              unitLabel: "clientes (top 8)",
              valueSuffix: "atenciones con las top 10 máquinas"
            }}
          >
            <Bar
              data={{
                labels: summary.maquinasClientes.clientes,
                datasets: summary.maquinasClientes.series.map((serie, i) => {
                  const base = DASHBOARD_PALETTE_SEQUENCE[i % DASHBOARD_PALETTE_SEQUENCE.length];
                  return {
                    label: serie.maquina,
                    data: serie.data,
                    backgroundColor: summary.maquinasClientes.clientes.map(cliente =>
                      !filters.cliente || cliente === filters.cliente ? base : withAlpha(base, 0.25)
                    )
                  };
                })
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } } },
                scales: { y: { beginAtZero: true, ticks: { font: { size: 12 } } }, x: { ticks: { font: { size: 12 } } } },
                onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                  toggleFilter("cliente", firstClickedLabel(elements, summary.maquinasClientes.clientes))
              }}
            />
          </ChartCard>
        </div>
      </div>

      {parts && (
        <div className="mb-3.5">
          <DataTableCard<PartsRow>
            title="Repuestos más utilizados en el período (solo repuestos Dolibarr con match real)"
            columns={partsColumns}
            rows={parts.rows}
            page={parts.page}
            totalPages={parts.totalPages}
            totalRows={parts.totalRows}
            onPageChange={setPartsPage}
            onRowClick={row => toggleFilter("sku", row.sku_dolibarr)}
          />
        </div>
      )}

      <span className={SECTION_LABEL_CLASS} style={SECTION_LABEL_STYLE}>
        Detalle operativo
      </span>
      {filters.estadoTicket && (
        <p
          className="mb-2 rounded-[var(--nx-radius-chip)] px-3 py-2 text-[12.5px]"
          style={{ background: "var(--nx-warning-bg)", color: "var(--nx-warning-fg)" }}
        >
          Este filtro no se aplica al detalle operativo en la versión actual.
        </p>
      )}
      {detail && (
        <div className="mb-3.5">
          <DataTableCard<DetailRow>
            title="Últimos reportes operativos"
            columns={detailColumns}
            rows={detail.rows}
            page={detail.page}
            totalPages={detail.totalPages}
            totalRows={detail.totalRows}
            onPageChange={setDetailPage}
            tableMinWidthPx={1250}
            headerExtra={
              <div className="mb-2.5 flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="ID Tarea Fieldbeat"
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
                  style={{
                    border: "1px solid var(--nx-border)",
                    borderRadius: "var(--nx-radius-button)",
                    color: "var(--nx-text-primary)",
                    minHeight: 44,
                    minWidth: 150,
                    padding: "0 12px",
                    fontSize: 13
                  }}
                  value={idTarea}
                  onChange={event => setIdTarea(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="ID Ticket"
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
                  style={{
                    border: "1px solid var(--nx-border)",
                    borderRadius: "var(--nx-radius-button)",
                    color: "var(--nx-text-primary)",
                    minHeight: 44,
                    minWidth: 150,
                    padding: "0 12px",
                    fontSize: 13
                  }}
                  value={idTicket}
                  onChange={event => setIdTicket(event.target.value)}
                />
              </div>
            }
          />
        </div>
      )}
    </>
  );
}
