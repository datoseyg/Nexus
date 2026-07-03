"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { PaginationControls } from "@/components/PaginationControls";
import { ErrorBanner } from "@/components/ErrorBanner";
import { downloadRowsAsCsv } from "@/lib/csv-export";
import { AppShell } from "@/components/ui/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

interface TableRef {
  table_schema: string;
  table_name: string;
}

interface ColumnRef {
  name: string;
  type: string;
}

interface TableDataResponse {
  schema: string;
  table: string;
  columns: ColumnRef[];
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export default function ExplorerPage() {
  const [tables, setTables] = useState<TableRef[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<TableDataResponse | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterColumn, setFilterColumn] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [appliedFilter, setAppliedFilter] = useState<{ column: string; value: string } | null>(null);

  useEffect(() => {
    fetch("/api/tables")
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw body;
        setTables(body.tables);
        if (body.tables.length > 0) {
          setSelected(`${body.tables[0].table_schema}.${body.tables[0].table_name}`);
        }
      })
      .catch(body => setError({ message: body?.error ?? "Error desconocido", code: body?.code }))
      .finally(() => setLoadingTables(false));
  }, []);

  useEffect(() => {
    if (!selected) return;

    const [schema, table] = selected.split(".");
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (sortColumn) {
      params.set("sortColumn", sortColumn);
      params.set("sortDir", sortDir);
    }
    if (appliedFilter?.column && appliedFilter.value) {
      params.set("filterColumn", appliedFilter.column);
      params.set("filterValue", appliedFilter.value);
    }

    setLoadingData(true);
    setError(null);

    fetch(`/api/tables/${schema}/${table}?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw body;
        setData(body);
      })
      .catch(body => setError({ message: body?.error ?? "Error desconocido", code: body?.code }))
      .finally(() => setLoadingData(false));
  }, [selected, page, sortColumn, sortDir, appliedFilter]);

  const columnNames = useMemo(() => data?.columns.map(c => c.name) ?? [], [data]);

  function handleTableChange(value: string) {
    setSelected(value);
    setPage(1);
    setSortColumn(null);
    setFilterColumn("");
    setFilterValue("");
    setAppliedFilter(null);
  }

  function handleSortChange(column: string) {
    if (sortColumn === column) {
      setSortDir(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
    setPage(1);
  }

  function handleApplyFilter() {
    setPage(1);
    setAppliedFilter(filterColumn && filterValue ? { column: filterColumn, value: filterValue } : null);
  }

  function handleClearFilter() {
    setFilterColumn("");
    setFilterValue("");
    setAppliedFilter(null);
    setPage(1);
  }

  function handleExport() {
    if (!data) return;
    downloadRowsAsCsv(`${data.schema}_${data.table}_pagina_${data.page}.csv`, columnNames, data.rows);
  }

  if (loadingTables) {
    return (
      <AppShell>
        <p style={{ color: "var(--text-muted)" }}>Cargando tablas…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Explorador de Tablas"
          description={
            <>
              Solo lectura. Para el significado de cada columna ver{" "}
              <a href="../../../docs/DATA_DICTIONARY.md" style={{ color: "var(--eyg-green-dark)" }}>
                DATA_DICTIONARY.md
              </a>
              .
            </>
          }
        />

        <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm" style={{ color: "var(--text-secondary)" }}>
          Tabla
          <select
            value={selected}
            onChange={event => handleTableChange(event.target.value)}
            className="mt-1 rounded border px-2 py-1"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          >
            {tables.map(table => {
              const value = `${table.table_schema}.${table.table_name}`;
              return (
                <option key={value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>

        <label className="flex flex-col text-sm" style={{ color: "var(--text-secondary)" }}>
          Columna a filtrar
          <select
            value={filterColumn}
            onChange={event => setFilterColumn(event.target.value)}
            className="mt-1 rounded border px-2 py-1"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          >
            <option value="">(elegir columna)</option>
            {columnNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm" style={{ color: "var(--text-secondary)" }}>
          Contiene
          <input
            type="text"
            value={filterValue}
            onChange={event => setFilterValue(event.target.value)}
            onKeyDown={event => event.key === "Enter" && handleApplyFilter()}
            className="mt-1 rounded border px-2 py-1"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
        </label>

        <button
          type="button"
          onClick={handleApplyFilter}
          className="rounded border px-3 py-1 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          Filtrar
        </button>

        {appliedFilter && (
          <button
            type="button"
            onClick={handleClearFilter}
            className="rounded border px-3 py-1 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Limpiar filtro
          </button>
        )}

        <button
          type="button"
          onClick={handleExport}
          disabled={!data || data.rows.length === 0}
          className="ml-auto rounded border px-3 py-1 text-sm disabled:opacity-40"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          Exportar página actual a CSV
        </button>
      </div>

      {error && <ErrorBanner message={error.message} code={error.code} />}

      {data && (
        <ResponsiveTableShell
          title={selected || "Tabla"}
          count={data.totalRows}
          countLabel="filas totales"
          loading={loadingData}
          empty={!loadingData && data.rows.length === 0}
          maxHeight={520}
          footer={
            <PaginationControls page={data.page} totalPages={data.totalPages} totalRows={data.totalRows} onPageChange={setPage} />
          }
        >
          <DataTable
            columnNames={columnNames}
            rows={data.rows}
            sortColumn={sortColumn}
            sortDir={sortDir}
            onSortChange={handleSortChange}
          />
        </ResponsiveTableShell>
      )}
      </div>
    </AppShell>
  );
}
