"use client";

import "@/lib/chartjs-setup";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar } from "react-chartjs-2";
import { FilterBar, type FilterConfig } from "./FilterBar";
import { KpiCard } from "./KpiCard";
import { ChartCard } from "./ChartCard";
import { DataTableCard, type DataTableColumn } from "./DataTableCard";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useDataRefreshEpoch } from "@/components/data-refresh/DataRefreshEpochProvider";
import type { Grain } from "@/lib/dashboard-filters";
import { DASHBOARD_PALETTE_SEQUENCE, formatDateTimeEsCl, formatMinutesAsHhMm, formatNumberEsCl } from "@/lib/dashboard-formatters";
import { BUTTON_PRIMARY, BUTTON_GHOST } from "@/components/ui/interactive";

interface UptimeSummary {
  kpis: {
    totalHorasRegistradas: number;
    correctivasProgramadas: number;
    correctivasNoProgramadas: number;
    preventivasProgramadas: number;
    requerimientoCliente: number;
    asistenciaRemota: number;
    instalacionIntegracion: number;
  };
  // Único flag real que gobierna el aviso metodológico (ver
  // /api/dashboard/uptime/summary/route.ts) - reemplaza el banner
  // estático anterior, que se mostraba siempre sin leer este campo.
  downtimeWarning: boolean;
}

interface TaskRow {
  fieldbeat_task_id: number;
  client_name: string | null;
  task_type: string | null;
  start_time: string | null;
  last_transition_at: string | null;
  duration_minutes: number | null;
}

interface UptimeTableRow {
  cliente: string;
  maquina: string;
  hrsPreventiva: number;
  hrsCorrectivaProgramada: number;
  hrsTotalRegistradas: number;
  hcCalc: null;
  uptimePct: null;
  tha: null;
  hcTeorica: null;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]";

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

export function UptimeDowntimeTab() {
  const [filterOptions, setFilterOptions] = useState<{
    clientes: string[];
    tiposTarea: string[];
    maquinas: string[];
    dateRange: { reportCentric: { min: string | null; max: string | null } };
  } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateRange, setDateRange] = useState<DateRangeValue>({ grain: "month" as Grain });
  const [taskIdSearch, setTaskIdSearch] = useState("");

  const [summary, setSummary] = useState<UptimeSummary | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [tasksPage, setTasksPage] = useState(1);
  const [tasks, setTasks] = useState<{ rows: TaskRow[]; page: number; totalPages: number; totalRows: number } | null>(null);

  const [tablePage, setTablePage] = useState(1);
  const [uptimeTable, setUptimeTable] = useState<{
    table: { rows: UptimeTableRow[]; page: number; totalPages: number; totalRows: number; pendingNote: string };
    periodChart: Array<{ anio: number; mes: number; horas: number }>;
  } | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  // NEXUS V3 - reusa el mismo botón "⟳ Actualizar datos" ya existente
  // (refreshKey) para reaccionar a un refresh de datos exitoso, en vez de un
  // mecanismo paralelo. isFirstEpochRef evita un refetch redundante al
  // montar: epoch ya vale lo que vale desde el primer render (no arranca en
  // "recién cambió"), así que solo bumpeamos refreshKey en cambios REALES
  // posteriores al mount, nunca en el mount mismo (las 3 queries de abajo ya
  // corren solas al montar).
  const epoch = useDataRefreshEpoch();
  const isFirstEpochRef = useRef(true);
  useEffect(() => {
    if (isFirstEpochRef.current) {
      isFirstEpochRef.current = false;
      return;
    }
    setRefreshKey(k => k + 1);
  }, [epoch]);

  useEffect(() => {
    fetch("/api/dashboard/operacional/filters")
      .then(res => res.json())
      .then(body =>
        setFilterOptions({ clientes: body.clientes, tiposTarea: body.tiposTarea, maquinas: body.maquinas, dateRange: body.dateRange })
      )
      .catch(() => setFilterOptions(null));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = toQueryString({ ...filters, from: dateRange.from, to: dateRange.to });
    fetch(`/api/dashboard/uptime/summary${query ? `?${query}` : ""}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setSummary(body);
      })
      .catch(body => setError({ message: body?.error ?? "Error desconocido", code: body?.code }))
      .finally(() => setLoading(false));
  }, [filters, dateRange, refreshKey]);

  useEffect(() => {
    const query = toQueryString({
      page: String(tasksPage),
      pageSize: "10",
      taskId: taskIdSearch,
      cliente: filters.cliente,
      tipo: filters.tipoTarea,
      from: dateRange.from,
      to: dateRange.to
    });
    fetch(`/api/dashboard/uptime/tasks?${query}`)
      .then(res => res.json())
      .then(setTasks)
      .catch(() => setTasks(null));
  }, [tasksPage, taskIdSearch, filters.cliente, filters.tipoTarea, dateRange, refreshKey]);

  useEffect(() => {
    const query = toQueryString({ page: String(tablePage), pageSize: "10", from: dateRange.from, to: dateRange.to });
    fetch(`/api/dashboard/uptime/table?${query}`)
      .then(res => res.json())
      .then(setUptimeTable)
      .catch(() => setUptimeTable(null));
  }, [tablePage, dateRange, refreshKey]);

  const filterConfigs: FilterConfig[] = useMemo(() => {
    if (!filterOptions) return [];
    return [
      { type: "select", key: "cliente", placeholder: "Cliente", options: filterOptions.clientes },
      { type: "select", key: "tipoTarea", placeholder: "Tipo", options: filterOptions.tiposTarea },
      { type: "select", key: "maquina", placeholder: "Máquina por S/N", options: filterOptions.maquinas }
    ];
  }, [filterOptions]);

  function handleFilterChange(key: string, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }));
    setTasksPage(1);
  }

  function handleClearFilters() {
    setFilters({});
    setDateRange({ grain: "month" });
    setTaskIdSearch("");
    setTasksPage(1);
  }

  const taskColumns: DataTableColumn<TaskRow>[] = [
    { key: "id", label: "Task_id", render: row => row.fieldbeat_task_id },
    { key: "cliente", label: "Cliente", render: row => row.client_name ?? "-" },
    { key: "tipo", label: "Tipo", render: row => row.task_type ?? "-" },
    { key: "inicio", label: "Hora de Inicio del Trabajo", render: row => formatDateTimeEsCl(row.start_time) },
    { key: "termino", label: "Hora de Término (aprox.)", render: row => formatDateTimeEsCl(row.last_transition_at) },
    { key: "duracion", label: "Duración Registrada", render: row => formatMinutesAsHhMm(row.duration_minutes) }
  ];

  const uptimeColumns: DataTableColumn<UptimeTableRow>[] = [
    { key: "cliente", label: "Cliente" },
    { key: "maquina", label: "Máquina (S/N)" },
    { key: "hrsPreventiva", label: "Hrs Preventiva", render: row => formatNumberEsCl(row.hrsPreventiva, 2) },
    { key: "hrsCorrectivaProgramada", label: "Hrs Corr. Programada", render: row => formatNumberEsCl(row.hrsCorrectivaProgramada, 2) },
    { key: "hrsTotalRegistradas", label: "Hrs Registradas (Total)", render: row => formatNumberEsCl(row.hrsTotalRegistradas, 2) },
    { key: "hcCalc", label: "HC_calc", render: () => "Pendiente" },
    { key: "uptimePct", label: "% Uptime", render: () => "Pendiente" },
    { key: "tha", label: "THA", render: () => "Pendiente" },
    { key: "hcTeorica", label: "HC Teórica", render: () => "Pendiente" }
  ];

  const chartByYear = useMemo(() => {
    if (!uptimeTable) return { years: [] as number[], datasets: [] as Array<{ label: string; data: number[] }> };

    const years = Array.from(new Set(uptimeTable.periodChart.map(p => p.anio))).sort();
    const datasets = years.map(year => ({
      label: String(year),
      data: MESES.map((_, monthIndex) => {
        const match = uptimeTable.periodChart.find(p => p.anio === year && p.mes === monthIndex + 1);
        return match ? Number(match.horas.toFixed(1)) : 0;
      })
    }));

    return { years, datasets };
  }, [uptimeTable]);

  const yearTotals = chartByYear.datasets.map(d => d.data.reduce((sum, v) => sum + v, 0));

  if (loading && !summary) {
    return (
      <p aria-busy="true" style={{ color: "var(--nx-text-secondary)" }}>
        Cargando horas registradas…
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

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className={`rounded-[var(--nx-radius-button)] px-3 py-2 text-[12.5px] font-semibold ${BUTTON_PRIMARY}`}
          style={{ background: "var(--nx-accent-indigo)", color: "#ffffff", minHeight: 40 }}
          onClick={() => setRefreshKey(k => k + 1)}
        >
          ⟳ Actualizar datos
        </button>
      </div>

      {summary?.downtimeWarning && (
        <div
          className="mb-4 rounded-[var(--nx-radius-card)] p-3.5"
          style={{ background: "var(--nx-warning-bg)", border: "1.5px solid var(--nx-warning-border)" }}
        >
          <p className="text-sm font-bold" style={{ color: "var(--nx-warning-fg)" }}>
            Las horas registradas no representan por sí solas la disponibilidad real del equipo.
          </p>
          <p className="mt-0.5 text-[13.5px]" style={{ color: "var(--nx-warning-fg)" }}>
            No existe una fórmula de uptime aprobada por negocio para este resumen.
          </p>
        </div>
      )}

      <div className="mb-4 min-w-0 rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="mb-2 flex items-center justify-between md:hidden">
          <span className="text-[12px] font-bold uppercase" style={{ color: "var(--nx-text-secondary)" }}>
            Filtros
          </span>
          <button
            type="button"
            aria-expanded={!filtersCollapsed}
            className={`rounded-[var(--nx-radius-button)] bg-[var(--nx-page-bg)] px-3 text-[12.5px] font-semibold ${BUTTON_GHOST}`}
            style={{ color: "var(--nx-text-secondary)", minHeight: 44 }}
            onClick={() => setFiltersCollapsed(v => !v)}
          >
            {filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
          </button>
        </div>
        <div className={`${filtersCollapsed ? "hidden" : "flex"} min-w-0 flex-col gap-2.5 md:flex`}>
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            min={filterOptions?.dateRange.reportCentric.min}
            max={filterOptions?.dateRange.reportCentric.max}
          />
          <FilterBar filters={filterConfigs} values={filters} onChange={handleFilterChange} onClear={handleClearFilters} />
        </div>
      </div>

      {tasks && (
        <div className="mb-4">
          <DataTableCard<TaskRow>
            title="Tabla de tareas"
            columns={taskColumns}
            rows={tasks.rows}
            page={tasks.page}
            totalPages={tasks.totalPages}
            totalRows={tasks.totalRows}
            onPageChange={setTasksPage}
            headerExtra={
              <input
                type="text"
                placeholder="Task_id"
                className={`mb-2.5 ${FOCUS_RING}`}
                style={{
                  border: "1px solid var(--nx-border)",
                  borderRadius: "var(--nx-radius-button)",
                  color: "var(--nx-text-primary)",
                  minHeight: 44,
                  minWidth: 150,
                  padding: "0 12px",
                  fontSize: 13
                }}
                value={taskIdSearch}
                onChange={event => {
                  setTaskIdSearch(event.target.value);
                  setTasksPage(1);
                }}
              />
            }
          />
        </div>
      )}

      <span className="mb-2.5 block text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--nx-text-secondary)" }}>
        Resumen de horas por tipo de tarea
      </span>
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <div
            className="flex min-w-0 flex-col gap-1 rounded-[var(--nx-radius-card)] p-4"
            style={{ background: "var(--nx-sidebar-bg)", boxShadow: "var(--nx-shadow-card-dark)" }}
          >
            <span className="text-[13px]" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
              Total de horas registradas
            </span>
            <span className="text-[26px] font-extrabold [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-sidebar-text-primary)" }}>
              {formatNumberEsCl(summary.kpis.totalHorasRegistradas, 2)}
            </span>
          </div>
          <KpiCard label="Correctivas programadas" value={formatNumberEsCl(summary.kpis.correctivasProgramadas, 2)} />
          <KpiCard label="Correctivas no programadas" value={formatNumberEsCl(summary.kpis.correctivasNoProgramadas, 2)} />
          <KpiCard label="Preventivas programadas" value={formatNumberEsCl(summary.kpis.preventivasProgramadas, 2)} />
          <KpiCard label="Requerimiento del cliente" value={formatNumberEsCl(summary.kpis.requerimientoCliente, 2)} />
          <KpiCard label="Asistencia remota" value={formatNumberEsCl(summary.kpis.asistenciaRemota, 2)} />
          <KpiCard label="Instalación - integración" value={formatNumberEsCl(summary.kpis.instalacionIntegracion, 2)} />
        </div>
      )}

      {uptimeTable && (
        <div className="mb-4">
          <DataTableCard<UptimeTableRow>
            title="Tabla de horas por cliente-máquina (parcial)"
            columns={uptimeColumns}
            rows={uptimeTable.table.rows}
            page={uptimeTable.table.page}
            totalPages={uptimeTable.table.totalPages}
            totalRows={uptimeTable.table.totalRows}
            onPageChange={setTablePage}
            footerNote={uptimeTable.table.pendingNote}
          />
        </div>
      )}

      <ChartCard
        title="Duración registrada por año-mes"
        subtitle="Suma de horas registradas por mes, agrupada por año."
        size="matrix"
        accessibleData={{
          labels: chartByYear.years.map(String),
          values: yearTotals,
          unitLabel: "años",
          valueSuffix: "horas registradas"
        }}
      >
        <Bar
          data={{
            labels: MESES,
            datasets: chartByYear.datasets.map((d, i) => ({
              ...d,
              backgroundColor: DASHBOARD_PALETTE_SEQUENCE[i % DASHBOARD_PALETTE_SEQUENCE.length]
            }))
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } } },
            scales: {
              y: { beginAtZero: true, ticks: { font: { size: 12 } }, title: { display: true, text: "Horas registradas", font: { size: 12 } } },
              x: { ticks: { font: { size: 12 } }, title: { display: true, text: "Mes", font: { size: 12 } } }
            }
          }}
        />
      </ChartCard>
    </>
  );
}
