"use client";

import "@/lib/chartjs-setup";
import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import styles from "./dashboard.module.css";
import { FilterBar, type FilterConfig } from "./FilterBar";
import { DataTableCard, type DataTableColumn } from "./DataTableCard";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";
import { ErrorBanner } from "@/components/ErrorBanner";
import type { Grain } from "@/lib/dashboard-filters";
import { DASHBOARD_PALETTE_SEQUENCE, formatDateTimeEsCl, formatMinutesAsHhMm, formatNumberEsCl } from "@/lib/dashboard-formatters";

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
    if (!uptimeTable) return { years: [], datasets: [] as Array<{ label: string; data: number[] }> };

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

  if (loading && !summary) {
    return <p style={{ color: "#6b7280" }}>Cargando integración Uptime / Downtime…</p>;
  }

  if (error) {
    return <ErrorBanner message={error.message} code={error.code} />;
  }

  return (
    <>
      <div className={styles.topActions}>
        <button type="button" className={`${styles.btn} ${styles.btnRefresh}`} onClick={() => setRefreshKey(k => k + 1)}>
          ⟳ ActualizarDatos
        </button>
        <h2 style={{ margin: 0, fontSize: 16, textAlign: "center", flex: 1 }}>
          Integración Dashboard del Proyecto 1 al del 7:
          <br />
          <span style={{ fontWeight: 400, fontSize: 14 }}>Visualización de horas registradas por cliente y tipo</span>
        </h2>
        <div style={{ width: 150 }} />
      </div>

      <div className={styles.pendingBanner}>
        <strong>Uptime/Downtime - pendiente de parametrización.</strong> Las métricas de este tab usan{" "}
        <code>duration_minutes</code> de FieldBeat como <strong>&quot;horas registradas&quot;</strong>, no como downtime real
        de equipo. El cálculo de uptime final requiere horas base por día/semana, feriados y una fórmula aprobada por
        negocio que todavía no existen en este warehouse.
      </div>

      <div className={styles.filterPanel}>
        <div className="flex items-center justify-between md:hidden" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--db-text-muted)", textTransform: "uppercase" }}>Filtros</span>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setFiltersCollapsed(v => !v)}>
            {filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
          </button>
        </div>
        <div className={styles.filterPanelBody} data-collapsed={filtersCollapsed}>
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
        <DataTableCard<TaskRow>
          title="Tabla de Tareas"
          columns={taskColumns}
          rows={tasks.rows}
          page={tasks.page}
          totalPages={tasks.totalPages}
          totalRows={tasks.totalRows}
          onPageChange={setTasksPage}
          headerExtra={
            <input
              type="text"
              className={styles.filterInput}
              placeholder="Task_id"
              value={taskIdSearch}
              onChange={event => {
                setTaskIdSearch(event.target.value);
                setTasksPage(1);
              }}
              style={{ marginBottom: 10 }}
            />
          }
        />
      )}

      <h3 style={{ margin: "20px 0 12px" }}>Suma de horas registradas que ha tomado cada Tipo de Tarea:</h3>
      {summary && (
        <>
          <div className={styles.kpiMiniGrid}>
            <div className={styles.kpiMini}>
              <div className="label">Correctivas Programadas</div>
              <div className="value">{formatNumberEsCl(summary.kpis.correctivasProgramadas, 2)}</div>
            </div>
            <div className={styles.kpiMini}>
              <div className="label">Correctivas No Programadas</div>
              <div className="value">{formatNumberEsCl(summary.kpis.correctivasNoProgramadas, 2)}</div>
            </div>
            <div className={styles.kpiMini}>
              <div className="label">Preventivas Programadas</div>
              <div className="value">{formatNumberEsCl(summary.kpis.preventivasProgramadas, 2)}</div>
            </div>
            <div className={styles.kpiMini}>
              <div className="label">Requerimiento del Cliente</div>
              <div className="value">{formatNumberEsCl(summary.kpis.requerimientoCliente, 2)}</div>
            </div>
            <div className={styles.kpiMini}>
              <div className="label">Asistencia Remota</div>
              <div className="value">{formatNumberEsCl(summary.kpis.asistenciaRemota, 2)}</div>
            </div>
            <div className={styles.kpiMini}>
              <div className="label">Instalación - Integración</div>
              <div className="value">{formatNumberEsCl(summary.kpis.instalacionIntegracion, 2)}</div>
            </div>
          </div>
          <div className={styles.kpiMini} style={{ maxWidth: 300, margin: "0 auto 20px" }}>
            <div className="label">Total Horas Registradas (todas las tareas)</div>
            <div className="value" style={{ color: "var(--db-danger, #d9534f)", fontSize: 22 }}>
              {formatNumberEsCl(summary.kpis.totalHorasRegistradas, 2)}
            </div>
          </div>
        </>
      )}

      {uptimeTable && (
        <DataTableCard<UptimeTableRow>
          title="Tabla Uptime/Downtime por Cliente-Máquina (parcial)"
          columns={uptimeColumns}
          rows={uptimeTable.table.rows}
          page={uptimeTable.table.page}
          totalPages={uptimeTable.table.totalPages}
          totalRows={uptimeTable.table.totalRows}
          onPageChange={setTablePage}
          footerNote={uptimeTable.table.pendingNote}
        />
      )}

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div className={styles.cardTitle}>Duración Registrada por Año-Mes (reemplaza &quot;Downtime&quot;)</div>
        <div className={styles.chartWrapTall}>
          <Bar
            data={{
              labels: MESES,
              datasets: chartByYear.datasets.map((d, i) => ({
                ...d,
                backgroundColor: DASHBOARD_PALETTE_SEQUENCE[i % DASHBOARD_PALETTE_SEQUENCE.length]
              }))
            }}
            options={{
              plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
              scales: {
                y: { beginAtZero: true, title: { display: true, text: "Horas registradas" } },
                x: { title: { display: true, text: "Mes" } }
              }
            }}
          />
        </div>
      </div>
    </>
  );
}
