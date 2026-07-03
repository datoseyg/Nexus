"use client";

import "@/lib/chartjs-setup";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, Doughnut, Line, Pie } from "react-chartjs-2";
import type { ChartEvent, ActiveElement } from "chart.js";
import styles from "./dashboard.module.css";
import { FilterBar, type FilterConfig } from "./FilterBar";
import { KpiCard } from "./KpiCard";
import { ChartCard } from "./ChartCard";
import { DataTableCard, type DataTableColumn } from "./DataTableCard";
import { MiniBarTableCell } from "./MiniBarTableCell";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";
import { FilterChips, type FilterChipItem } from "./FilterChips";
import { ErrorBanner } from "@/components/ErrorBanner";
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

export function OperationalDashboardTab() {
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
  // para que sea compartible — ver docs/DASHBOARD_VISUAL_STYLE.md.
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
  }, [filters]);

  useEffect(() => {
    const query = toQueryString({ page: String(partsPage), pageSize: "10", ...(filters as unknown as Record<string, string | undefined>) });
    fetch(`/api/dashboard/operacional/parts?${query}`)
      .then(res => res.json())
      .then(setParts)
      .catch(() => setParts(null));
  }, [partsPage, filters]);

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
  }, [detailPage, idTarea, idTicket, filters]);

  const resetPages = useCallback(() => {
    setPartsPage(1);
    setDetailPage(1);
  }, []);

  function handleFilterChange(key: string, value: string) {
    setFilters(prev => ({ ...prev, [key]: value || undefined }));
    resetPages();
  }

  // Cross-filter: click en un gráfico agrega/actualiza el filtro global
  // correspondiente (toggle: click de nuevo sobre la misma categoría lo
  // quita) — ver docs/DASHBOARD_VISUAL_STYLE.md § Cross-filter.
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
    return <p style={{ color: "var(--db-text-muted, #6b7280)" }}>Cargando dashboard operacional…</p>;
  }

  if (error) {
    return <ErrorBanner message={error.message} code={error.code} />;
  }

  if (!summary) return null;

  const partsColumns: DataTableColumn<PartsRow>[] = [
    { key: "info", label: "Info.", render: (_row, i) => `${((parts?.page ?? 1) - 1) * 10 + i + 1}.` },
    { key: "sku", label: "SKU Dolibarr", render: row => row.sku_dolibarr },
    { key: "nombre", label: "Nombre Repuesto", render: row => row.nombre_repuesto || "—" },
    { key: "reportes", label: "Reportes", render: row => formatNumberEsCl(row.reportes_asociados) },
    { key: "clientes", label: "Clientes", render: row => formatNumberEsCl(row.clientes_asociados) },
    {
      key: "cantidad",
      label: "Cantidad Consumida",
      render: row => <MiniBarTableCell value={row.cantidad_consumida} max={parts?.rows[0]?.cantidad_consumida ?? row.cantidad_consumida} />
    }
  ];

  const detailColumns: DataTableColumn<DetailRow>[] = [
    { key: "fecha", label: "Fecha y Hora de Finalización", render: row => formatDateTimeEsCl(row.fieldbeat_task_date) },
    { key: "origen", label: "Origen", render: row => row.origen },
    { key: "idTarea", label: "ID Tarea Fieldbeat", render: row => row.fieldbeat_task_id },
    { key: "cliente", label: "Cliente", render: row => row.client_name },
    { key: "idTicket", label: "ID Ticket", render: row => row.linked_zendesk_ticket_id || "—" },
    { key: "maquina", label: "Máquina", render: row => row.equipment_internal_ids || "—" },
    { key: "skuLink", label: "SKU link", render: row => row.used_part_numbers || "—" },
    { key: "tipo", label: "Tipo de Tarea", render: row => row.task_type },
    { key: "cantidad", label: "Cantidad Descontada", render: row => row.used_parts_count }
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
  const ticketsClienteColors = highlightColors(summary.ticketsCliente.map(v => v.cliente), DASHBOARD_PALETTE_SEQUENCE, filters.cliente);
  const estadoGeneralColors = summary.estadoGeneral.map(e =>
    !filters.reportQuality || e.estado === filters.reportQuality ? DASHBOARD_PALETTE.teal : withAlpha(DASHBOARD_PALETTE.teal, 0.25)
  );

  return (
    <>
      <div className={styles.filterPanel}>
        <div className="flex items-center justify-between md:hidden" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--db-text-muted)", textTransform: "uppercase" }}>Filtros</span>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setFiltersCollapsed(v => !v)}
          >
            {filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
          </button>
        </div>

        <div className={styles.filterPanelBody} data-collapsed={filtersCollapsed}>
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
                className={styles.filterInput}
                placeholder="🔍 SKU Repuesto"
                value={filters.sku ?? ""}
                onChange={event => handleFilterChange("sku", event.target.value)}
              />
            }
          />
        </div>
      </div>

      <div className={styles.kpiRow}>
        <KpiCard label="Total Registros FieldBeat" value={formatNumberEsCl(summary.kpis.totalRegistros)} />
        <KpiCard label="Total Tickets Zendesk" value={formatNumberEsCl(summary.kpis.totalTickets)} />
        <KpiCard label="Repuestos Usados" value={formatNumberEsCl(summary.kpis.repuestosUsados)} />
        <KpiCard label="% con Ticket Reportado" value={formatPercent(summary.kpis.pctConTicketReportado)} />
        <KpiCard label="% con Ticket Zendesk Accesible" value={formatPercent(summary.kpis.pctConTicketAccesible)} />
        <KpiCard label="Descargar Informe" value="⬇ Descargar Informe (JSON)" variant="action" onClick={handleDownloadReport} />
        <KpiCard label="Último Cliente" value={summary.kpis.ultimoCliente ?? "—"} variant="client" />
      </div>

      <div className={`${styles.grid} ${styles.grid2}`}>
        <ChartCard title="Distribución de Estados (Tickets Zendesk)">
          <Bar
            data={{
              labels: summary.estados.map(e => e.estado),
              datasets: [{ data: summary.estados.map(e => e.cantidad), backgroundColor: estadosColors, borderRadius: 4, maxBarThickness: 60 }]
            }}
            options={{
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true } },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("estadoTicket", firstClickedLabel(elements, summary.estados.map(e => e.estado)))
            }}
          />
        </ChartCard>
        <p style={{ fontSize: 11, color: "#6b7280", marginTop: -6 }}>
          Cerrado incluye closed + solved. Abierto incluye open + new. Pendiente agrupa pending y otros estados no cerrados. Click en
          una barra filtra el resto del dashboard por ese estado.
        </p>

        <ChartCard title={`Evolución Operativa (Tiempo, agrupado por ${filters.grain === "day" ? "día" : filters.grain === "week" ? "semana" : "mes"}) — solo serie General`}>
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
            options={{ plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } }}
          />
        </ChartCard>
      </div>
      <p style={{ fontSize: 11, color: "#6b7280", marginTop: -8, marginBottom: 14 }}>
        La serie &quot;Apoteca&quot; del dashboard de referencia se puede aproximar con el filtro &quot;Origen Registro&quot; (heurística
        basada en equipment_internal_ids) — no existe un campo de origen dedicado en este warehouse.
      </p>

      <div className={`${styles.grid} ${styles.grid4}`}>
        <ChartCard
          title="Uso Bodegas (Dimensión Clientes)"
          available={summary.bodegasClientes.available}
          unavailableReason="Sin repuestos con bodega de origen registrada para este filtro."
        >
          <Pie
            data={{
              labels: summary.bodegasClientes.values.map(v => v.cliente),
              datasets: [{ data: summary.bodegasClientes.values.map(v => v.cantidad), backgroundColor: bodegasClientesColors }]
            }}
            options={{
              plugins: {
                legend: { position: "right", labels: { boxWidth: 10, font: { size: 9 } } },
                tooltip: {
                  callbacks: {
                    label: ctx => {
                      const v = summary.bodegasClientes.values[ctx.dataIndex];
                      return ` ${v.cliente} — ${formatNumberEsCl(v.cantidad)} usos (${formatPercent(v.pct, 1)})`;
                    }
                  }
                }
              },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("cliente", firstClickedLabel(elements, summary.bodegasClientes.values.map(v => v.cliente)))
            }}
          />
        </ChartCard>

        <ChartCard
          title="Ranking Bodegas Utilizadas"
          available={summary.rankingBodegas.available}
          unavailableReason="Sin repuestos con bodega de origen registrada para este filtro."
        >
          <Doughnut
            data={{
              labels: summary.rankingBodegas.values.map(v => v.bodega),
              datasets: [{ data: summary.rankingBodegas.values.map(v => v.cantidad), backgroundColor: rankingBodegasColors }]
            }}
            options={{
              plugins: {
                legend: { position: "right", labels: { boxWidth: 10, font: { size: 9 } } },
                tooltip: {
                  callbacks: {
                    label: ctx => {
                      const v = summary.rankingBodegas.values[ctx.dataIndex];
                      return ` ${v.bodega} — ${formatNumberEsCl(v.cantidad)} usos (${formatPercent(v.pct, 1)})`;
                    }
                  }
                }
              },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("bodega", firstClickedLabel(elements, summary.rankingBodegas.values.map(v => v.bodega)))
            }}
          />
        </ChartCard>

        <ChartCard title="% Tickets por Cliente (accesibles)">
          <Doughnut
            data={{
              labels: summary.ticketsCliente.map(v => v.cliente),
              datasets: [{ data: summary.ticketsCliente.map(v => v.pct), backgroundColor: ticketsClienteColors }]
            }}
            options={{
              plugins: {
                legend: { position: "right", labels: { boxWidth: 10, font: { size: 9 } } },
                tooltip: {
                  callbacks: {
                    label: ctx => {
                      const v = summary.ticketsCliente[ctx.dataIndex];
                      return ` ${v.cliente} — ${v.accesibles}/${v.total} accesibles (${formatPercent(v.pct, 1)})`;
                    }
                  }
                }
              },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("cliente", firstClickedLabel(elements, summary.ticketsCliente.map(v => v.cliente)))
            }}
          />
        </ChartCard>

        <ChartCard title="Estado General">
          <Bar
            data={{
              labels: summary.estadoGeneral.map(e => e.estado),
              datasets: [{ data: summary.estadoGeneral.map(e => e.cantidad), backgroundColor: estadoGeneralColors }]
            }}
            options={{
              indexAxis: "y" as const,
              plugins: { legend: { display: false } },
              scales: { x: { beginAtZero: true } },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("reportQuality", firstClickedLabel(elements, summary.estadoGeneral.map(e => e.estado)))
            }}
          />
        </ChartCard>
      </div>

      <div className={`${styles.grid} ${styles.rowFull}`}>
        <ChartCard title="Atenciones Máquinas x Clientes (top, click = filtrar por cliente)" tall>
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
              plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 9 } } } },
              scales: { y: { beginAtZero: true } },
              onClick: (_evt: ChartEvent, elements: ActiveElement[]) =>
                toggleFilter("cliente", firstClickedLabel(elements, summary.maquinasClientes.clientes))
            }}
          />
        </ChartCard>
      </div>

      {parts && (
        <div className={`${styles.grid} ${styles.rowFull}`}>
          <DataTableCard<PartsRow>
            title="Tabla: Uso de Repuestos (solo repuestos Dolibarr con match real)"
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

      {detail && (
        <div className={`${styles.grid} ${styles.rowFull}`}>
          <DataTableCard<DetailRow>
            title="Detalle Operativo"
            columns={detailColumns}
            rows={detail.rows}
            page={detail.page}
            totalPages={detail.totalPages}
            totalRows={detail.totalRows}
            onPageChange={setDetailPage}
            headerExtra={
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  className={styles.filterInput}
                  placeholder="ID Tarea Fieldbeat"
                  value={idTarea}
                  onChange={event => setIdTarea(event.target.value)}
                />
                <input
                  type="text"
                  className={styles.filterInput}
                  placeholder="Id Ticket"
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
