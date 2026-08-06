"use client";

import { useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { isReportsEmpty } from "@/lib/fieldbeat-tab-empty-predicates";
import { REPORTS_PAGE_SIZES } from "@/lib/fieldbeat-reports-queries";
import { triggerBlobDownload } from "@/lib/csv-export";
import { FIELDBEAT_REPORTS_FOCUS_FALLBACK_ID } from "./FieldbeatReportDetailDrawer";
import type { FieldbeatReportRow, FieldbeatReportsDirection, FieldbeatReportsResponse, FieldbeatReportsSortKey, FieldbeatReportsView } from "@/types/fieldbeat-reports";
import { BASE_TRANSITION, FOCUS_RING, BUTTON_TEXT, BUTTON_PRIMARY, BUTTON_PAGINATION, BUTTON_SORT } from "@/components/ui/interactive";

interface FieldbeatReportsTabProps {
  query: string;
  exportQuery: string;
  view: FieldbeatReportsView;
  page: number;
  pageSize: number;
  sort: FieldbeatReportsSortKey;
  direction: FieldbeatReportsDirection;
  search: string | null;
  selectedReportId: string | null;
  onViewChange: (view: FieldbeatReportsView) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSortChange: (sort: FieldbeatReportsSortKey, direction: FieldbeatReportsDirection) => void;
  onSearchChange: (search: string | null) => void;
  onSelectReport: (id: string | null) => void;
}

const SEVERITY_STYLE: Record<string, { bg: string; fg: string }> = {
  Alta: { bg: "var(--nx-danger-bg, #fdecea)", fg: "var(--nx-danger-fg, #b3261e)" },
  Media: { bg: "var(--nx-warning-bg, #fff4e0)", fg: "var(--nx-warning-fg, #8a5a00)" },
  Baja: { bg: "var(--nx-page-bg)", fg: "var(--nx-text-secondary)" },
  Advertencia: { bg: "var(--nx-page-bg)", fg: "var(--nx-text-muted)" }
};

// Insignia de severidad - color NUNCA solo (siempre acompañado del texto
// de la severidad, ver skill dataviz "status colors reserved... nunca
// color solo"). Reportes limpios ("Todos los reportes") usan una insignia
// de éxito distinta, nunca la ausencia de insignia (ambigua con "cargando").
function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-[var(--nx-radius-chip)] px-2 py-0.5 text-[11.5px] font-semibold"
        style={{ background: "var(--nx-success-bg, #e8f5e9)", color: "var(--nx-success-fg, #2e7d32)" }}
      >
        Sin inconsistencias
      </span>
    );
  }
  const style = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.Baja;
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--nx-radius-chip)] px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: style.bg, color: style.fg }}>
      {severity}
    </span>
  );
}

const SORT_COLUMNS: Array<{ key: FieldbeatReportsSortKey; label: string }> = [
  { key: "date", label: "Fecha" },
  { key: "severity", label: "Severidad" },
  { key: "client", label: "Cliente" },
  { key: "technician", label: "Técnico" },
  { key: "taskType", label: "Tipo de tarea" },
  { key: "id", label: "ID" }
];

function findingsSummary(row: FieldbeatReportRow): string {
  const secondary = row.findings.filter(f => f.code !== row.primary?.code);
  if (secondary.length === 0) return "-";
  return secondary.map(f => f.code).join(", ");
}

// Bandeja definitiva de Reportes (Phase 4) - reemplaza la tabla/endpoint
// transitorios de Phase 3 §10. "Excepciones" (default) reconcilia
// exactamente con KPI6.affectedReports bajo el mismo filtro (misma base
// SQL, ver lib/fieldbeat-reports-queries.ts); "Todos los reportes" agrega
// los limpios, nunca inventa un estado de workflow nuevo. Selección de
// fila prepara (no implementa) el drawer de Phase 5: actualiza
// selectedReportId en la URL (?report=<id>), sin renderizar ningún panel
// todavía.
export function FieldbeatReportsTab({
  query,
  exportQuery,
  view,
  page,
  pageSize,
  sort,
  direction,
  search,
  selectedReportId,
  onViewChange,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onSearchChange,
  onSelectReport
}: FieldbeatReportsTabProps) {
  const [searchDraft, setSearchDraft] = useState(search ?? "");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { status, data, error, retry } = useAfterHoursSection<FieldbeatReportsResponse>("/api/dashboard/fieldbeat/reports", query, isReportsEmpty);
  const loading = status === "idle" || status === "loading";

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSearchChange(searchDraft.trim() || null);
  }

  // Phase 5 preflight §2.3 - fetch en vez de <a href> plano: el servidor
  // puede rechazar con 413 (universo filtrado > MAX_EXPORT_ROWS, ver
  // app/api/dashboard/fieldbeat/reports/export/route.ts) y esa respuesta es
  // JSON, no CSV - un <a> nativo la descargaría como si fuera el archivo
  // (nunca un CSV truncado presentado como completo, pero tampoco un
  // "archivo" roto sin explicación). Con fetch se puede mostrar el motivo
  // real y dejar que el usuario acote filtros antes de reintentar.
  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/dashboard/fieldbeat/reports/export?${exportQuery}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExportError(body?.error ?? `No fue posible exportar (HTTP ${res.status}).`);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? "fieldbeat-reportes.csv";
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
    } catch {
      setExportError("No fue posible exportar - revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  function handleSort(key: FieldbeatReportsSortKey) {
    if (key === sort) onSortChange(key, direction === "asc" ? "desc" : "asc");
    else onSortChange(key, key === "id" || key === "client" || key === "technician" || key === "taskType" ? "asc" : "desc");
  }

  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Destino de foco de respaldo (Phase 5) - cuando el drawer de
          detalle se cierra y se abrió por URL directa (deep-link, sin
          click previo del usuario), FieldbeatReportDetailDrawer mueve el
          foco acá en vez de dejarlo perdido en <body>. tabIndex=-1: nunca
          entra al orden de Tab, solo es alcanzable programáticamente. */}
      <div id={FIELDBEAT_REPORTS_FOCUS_FALLBACK_ID} tabIndex={-1} className="sr-only" />
      <div aria-live="polite" className="sr-only">
        {loading ? "Cargando reportes…" : status === "empty" ? "Sin reportes para el filtro actual." : ""}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
          <legend className="mb-1 text-[12px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
            Vista
          </legend>
          {(["exceptions", "all"] as const).map(v => {
            const isActive = v === view;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  if (!isActive) onViewChange(v);
                }}
                className={`rounded-[var(--nx-radius-chip)] cursor-pointer px-3 py-1.5 text-[12.5px] font-semibold ${BASE_TRANSITION} ${FOCUS_RING} ${
                  isActive
                    ? "bg-[var(--nx-accent-indigo)] text-white hover:bg-[var(--nx-accent-indigo-hover)] active:bg-[var(--nx-accent-indigo-hover)]"
                    : "border border-[var(--nx-border)] bg-[var(--nx-page-bg)] text-[var(--nx-text-secondary)] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 active:bg-indigo-100"
                }`}
              >
                {v === "exceptions" ? "Excepciones" : "Todos los reportes"}
              </button>
            );
          })}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleSearchSubmit} role="search" className="flex items-center gap-1.5">
            <label htmlFor="fieldbeat-reports-search" className="sr-only">
              Buscar por ID de reporte
            </label>
            <input
              id="fieldbeat-reports-search"
              type="text"
              inputMode="numeric"
              placeholder="ID de reporte"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              className="rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-[12.5px]"
              style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", color: "var(--nx-text-primary)", width: 140 }}
            />
            <button
              type="submit"
              className={`rounded-[var(--nx-radius-chip)] cursor-pointer bg-[var(--nx-page-bg)] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-indigo-50 hover:text-indigo-900 active:bg-indigo-100 ${BASE_TRANSITION} ${FOCUS_RING}`}
              style={{ color: "var(--nx-text-secondary)", border: "1px solid var(--nx-border)" }}
            >
              Buscar
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  onSearchChange(null);
                }}
                className={`text-[12px] underline ${BUTTON_TEXT}`}
                style={{ color: "var(--nx-text-muted)" }}
              >
                Limpiar búsqueda
              </button>
            )}
          </form>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className={`rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON_PRIMARY}`}
            style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
          >
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      {exportError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <ErrorBanner message={exportError} />
        </div>
      )}

      {status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <ErrorBanner message={error ?? "No fue posible cargar los reportes."} />
          <button
            type="button"
            onClick={retry}
            className={`rounded-[var(--nx-radius-chip)] px-3.5 py-1.5 text-[13px] font-semibold ${BUTTON_PRIMARY}`}
            style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
          >
            Reintentar
          </button>
        </div>
      )}

      {status !== "error" && (
        <ResponsiveTableShell
          title="Reportes"
          count={data?.totalRows ?? 0}
          countLabel="reportes"
          loading={loading}
          empty={status === "empty"}
          emptyMessage="No hay reportes que coincidan con los filtros actuales."
          maxHeight="none"
          footer={
            data && (
              <div className="flex flex-wrap items-center justify-end gap-3 text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
                <span className="mr-auto">
                  Mostrando {data.effectiveRangeFrom.toLocaleString("es-CL")}-{data.effectiveRangeTo.toLocaleString("es-CL")} de {data.totalRows.toLocaleString("es-CL")}
                </span>
                <label htmlFor="fieldbeat-reports-page-size" className="sr-only">
                  Filas por página
                </label>
                <select
                  id="fieldbeat-reports-page-size"
                  value={pageSize}
                  onChange={e => onPageSizeChange(Number(e.target.value))}
                  className="rounded-[var(--nx-radius-chip)] border px-2 py-1"
                  style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}
                >
                  {REPORTS_PAGE_SIZES.map(size => (
                    <option key={size} value={size}>
                      {size} / página
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onPageChange(page - 1)}
                  disabled={!data.hasPrevious}
                  aria-label="Página anterior"
                  className={BUTTON_PAGINATION}
                  style={{ border: "1px solid var(--nx-border)", borderRadius: "var(--nx-radius-button)", minWidth: 36, minHeight: 36 }}
                >
                  ‹
                </button>
                <span>
                  Página {data.page} de {data.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => onPageChange(page + 1)}
                  disabled={!data.hasNext}
                  aria-label="Página siguiente"
                  className={BUTTON_PAGINATION}
                  style={{ border: "1px solid var(--nx-border)", borderRadius: "var(--nx-radius-button)", minWidth: 36, minHeight: 36 }}
                >
                  ›
                </button>
              </div>
            )
          }
        >
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <caption className="sr-only">
              Reportes FieldBeat, vista {view === "exceptions" ? "Excepciones" : "Todos los reportes"}, {data?.totalRows ?? 0} en total.
            </caption>
            <thead>
              <tr>
                {SORT_COLUMNS.map(col => (
                  <th key={col.key} scope="col" className="border-b p-2 text-left" style={{ borderColor: "var(--nx-border)" }}>
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      aria-sort={sort === col.key ? (direction === "asc" ? "ascending" : "descending") : "none"}
                      className={`flex items-center gap-1 px-1 font-semibold ${BUTTON_SORT}`}
                      style={{ color: "var(--nx-text-secondary)" }}
                    >
                      {col.label}
                      {sort === col.key && <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
                <th scope="col" className="border-b p-2 text-left" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
                  Hallazgos adicionales
                </th>
                <th scope="col" className="border-b p-2 text-left" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
                  Seleccionar
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isSelected = selectedReportId === row.fieldbeatTaskId;
                return (
                  <tr key={row.fieldbeatTaskId} style={isSelected ? { background: "var(--nx-page-bg)" } : undefined}>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      {row.fecha ? new Date(row.fecha).toLocaleDateString("es-CL") : "-"}
                    </td>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      <SeverityBadge severity={row.primary?.severity ?? null} />
                    </td>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      {row.cliente ?? "-"}
                    </td>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      {row.tecnico ?? "-"}
                    </td>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      {row.tipoTarea ?? "-"}
                    </td>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      {row.fieldbeatTaskId}
                    </td>
                    <td className="border-b p-2 text-[11.5px]" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" }}>
                      {findingsSummary(row)}
                    </td>
                    <td className="border-b p-2" style={{ borderColor: "var(--nx-border)" }}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onSelectReport(isSelected ? null : row.fieldbeatTaskId)}
                        className={`rounded-[var(--nx-radius-chip)] cursor-pointer px-2.5 py-1 text-[11.5px] font-semibold ${BASE_TRANSITION} ${FOCUS_RING} ${
                          isSelected
                            ? "bg-[var(--nx-accent-indigo)] text-white hover:bg-[var(--nx-accent-indigo-hover)] active:bg-[var(--nx-accent-indigo-hover)]"
                            : "border border-[var(--nx-border)] bg-[var(--nx-page-bg)] text-[var(--nx-text-secondary)] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 active:bg-indigo-100"
                        }`}
                      >
                        {isSelected ? "Seleccionado" : "Seleccionar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ResponsiveTableShell>
      )}
    </div>
  );
}
