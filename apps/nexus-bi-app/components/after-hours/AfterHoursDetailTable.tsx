"use client";

import { useId, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { buildDiagnosis, getConfidenceTierLabel } from "@/lib/after-hours-labels";
import { formatHoursOrDash, isAfterHoursRowSelected, parseReportIdInput, splitDateTime, totalAfterHoursHours } from "@/lib/after-hours-detail-view";
import { formatModelCell } from "@/lib/explorer-entity-config";
import { triggerBlobDownload } from "@/lib/csv-export";
import type { AfterHoursDetailRow } from "@/types/after-hours";
import { BASE_TRANSITION, BUTTON_PAGINATION, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_SORT, BUTTON_TEXT, FOCUS_RING } from "@/components/ui/interactive";

export type DetailSortColumn = "start_time" | "duration" | "after_hours_rate" | "confidence_score" | "fieldbeat_task_id";
export type DetailSortDir = "asc" | "desc";

interface AfterHoursDetailTableProps {
  rows: AfterHoursDetailRow[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  sortBy: DetailSortColumn;
  sortDir: DetailSortDir;
  onSortChange: (column: DetailSortColumn) => void;
  onRowClick: (row: AfterHoursDetailRow) => void;
  /** Sección 14 del encargo NEXUS V3 After-Hours - misma identidad usada
   * para React key/drawer (fieldbeat_task_id), comparada acá solo para el
   * resaltado visual de la fila abierta. */
  selectedTaskId: number | null;
  /** Buscador de N.º de reporte (encabezado) - número YA validado y
   * actualmente aplicado (fuente de verdad en AfterHoursShell, misma
   * ubicación que detailPage/sortBy: el fetch de detalle depende de este
   * valor). null = sin filtro por reporte. */
  reportIdFilter: number | null;
  onReportIdFilterChange: (reportId: number | null) => void;
  /** Query ya serializada (AfterHoursShell.tsx, buildAfterHoursQuery) con los
   * MISMOS filtros/reportId que detailQuery pero SIN page/pageSize - la
   * exportación cubre siempre el universo filtrado completo. */
  exportQuery: string;
}

// Sección 14.2 del encargo - N.º de reporte (fieldbeat_task_id, misma
// identidad visible que ya usa el título del drawer canónico "Tarea #<id>"
// y la columna "Reporte" del Explorador - nunca un campo inventado, ver
// reporte final § "Identidad del reporte") y Modelo (columna nueva,
// separada de "ID del equipo" - nunca reemplaza el identificador de
// activo). "Equipo" se renombra a "ID del equipo" cuando el valor es un
// código crudo (equipment_internal_ids), sin cambiar el valor mostrado.
const COLUMNS: Array<{ key: string; label: string; sortKey?: DetailSortColumn }> = [
  { key: "date", label: "Fecha", sortKey: "start_time" },
  { key: "reportNumber", label: "Reporte", sortKey: "fieldbeat_task_id" },
  { key: "technician", label: "Técnico" },
  { key: "client", label: "Cliente" },
  { key: "equipment", label: "ID del equipo" },
  { key: "model", label: "Modelo" },
  { key: "taskType", label: "Tipo de tarea" },
  { key: "start", label: "Inicio" },
  { key: "end", label: "Término" },
  { key: "afterHours", label: "Tiempo fuera de horario", sortKey: "duration" },
  { key: "confidence", label: "Confianza", sortKey: "confidence_score" },
  { key: "diagnosis", label: "Diagnóstico" }
];

const SKELETON_WIDTHS = [90, 75, 85, 60, 80];

// Input del buscador de reporte - mismo lenguaje visual que FORM_CONTROL
// (components/ui/interactive.ts) pero sin su min-h-11 forzado (el
// encabezado de esta tabla ya usa controles compactos, ver BUTTON_PAGINATION
// más abajo) y sin cursor-pointer (es texto libre, no un selector).
const REPORT_SEARCH_INPUT_CLASS = `${BASE_TRANSITION} ${FOCUS_RING} border border-[var(--nx-border)] bg-white hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-50`;

// Tabla "Registros detectados fuera de horario" (ETAPA 6.6D §11, ampliada
// Sección 14 del encargo NEXUS V3 After-Hours) - columnas del prototipo +
// N.º de reporte/Modelo + Diagnóstico (traduce data_basis/fallback_used/
// coverage_reason_code/contractual_reason_code a texto legible vía
// lib/after-hours-labels.ts, nunca códigos técnicos como texto principal).
// data_basis=NONE nunca muestra "0 min" (§11): totalAfterHours() retorna
// null cuando business_hours es null (cobertura no calculable), la celda
// pinta "—".
export function AfterHoursDetailTable({
  rows,
  loading,
  error,
  page,
  pageSize,
  totalRows,
  totalPages,
  onPageChange,
  sortBy,
  sortDir,
  onSortChange,
  onRowClick,
  selectedTaskId,
  reportIdFilter,
  onReportIdFilterChange,
  exportQuery
}: AfterHoursDetailTableProps) {
  // Draft de escritura, local a este componente (no dispara fetch por sí
  // solo - reportIdFilter, en AfterHoursShell, es lo único que lo hace, y
  // solo al enviar el formulario/Limpiar). reportSearchError es
  // exclusivamente de validación de ENTRADA (formato); el caso "0
  // resultados para un reportIdFilter válido" se resuelve más abajo, en el
  // bloque de estado vacío, a partir de reportIdFilter + rows, no de este
  // estado.
  const [reportSearchInput, setReportSearchInput] = useState("");
  const [reportSearchError, setReportSearchError] = useState<string | null>(null);
  const reportSearchInputId = useId();
  const reportSearchErrorId = useId();

  // Botón "Descargar CSV" - mismo patrón que FieldbeatReportsTab.tsx::handleExport
  // (fetch en vez de <a href> plano: el servidor puede responder JSON en vez
  // de CSV - 200 sin resultados, 413 sobre el límite, 401/403/400 - y esa
  // respuesta nunca debe dispararse como descarga). `exporting` previene
  // descargas simultáneas (guard explícito + disabled del botón).
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    if (exporting) return;
    // totalRows ya refleja el mismo universo filtrado que exportQuery (el
    // conteo del listado paginado no excluye nada que la exportación
    // incluya) - evita una ida y vuelta de red para el caso vacío, que de
    // todos modos el servidor también rechaza como no-CSV por seguridad.
    if (totalRows === 0) {
      setExportError("No hay registros para exportar con los filtros aplicados.");
      return;
    }
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/dashboard/after-hours/export?${exportQuery}`);
      const contentType = res.headers.get("Content-Type") ?? "";
      if (!res.ok || !contentType.includes("text/csv")) {
        const body = await res.json().catch(() => null);
        setExportError(body?.error ?? `No fue posible exportar (HTTP ${res.status}).`);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? `nexus_fuera_de_horario_${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
    } catch {
      setExportError("No fue posible exportar - revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  function applyReportSearch() {
    const parsed = parseReportIdInput(reportSearchInput);
    if (parsed === null) {
      setReportSearchError("Ingresa un número de reporte válido, por ejemplo 3811 o #3811.");
      return;
    }
    setReportSearchError(null);
    onReportIdFilterChange(parsed);
  }

  function handleClearReportSearch() {
    setReportSearchInput("");
    setReportSearchError(null);
    onReportIdFilterChange(null);
  }

  return (
    <div className="mb-2 overflow-hidden rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4.5 py-3.5" style={{ borderColor: "var(--nx-border)" }}>
        <div className="text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
          Registros detectados fuera de horario
        </div>
        {totalRows > 0 && (
          <span className="text-[12.5px]" style={{ color: "var(--nx-text-muted)" }}>
            {totalRows.toLocaleString("es-CL")} registros
          </span>
        )}

        {/* Buscador exacto por N.º de reporte (fieldbeat_task_id) - solo
            afecta esta tabla (reportIdFilter vive en AfterHoursShell, se
            pasa como `extra.reportId` a buildAfterHoursQuery SOLO para
            detailQuery, nunca para filtersQuery) - nunca un filtro general
            de After-Hours. Sin debounce: solo aplica al enviar el form
            (submit/Enter) o al click en Buscar. */}
        <form
          role="search"
          onSubmit={event => {
            event.preventDefault();
            applyReportSearch();
          }}
          className="ml-auto flex flex-wrap items-center gap-1.5"
        >
          <label htmlFor={reportSearchInputId} className="sr-only">
            Buscar reporte por número
          </label>
          <input
            id={reportSearchInputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Buscar reporte"
            value={reportSearchInput}
            onChange={event => setReportSearchInput(event.target.value)}
            aria-invalid={reportSearchError ? true : undefined}
            aria-describedby={reportSearchError ? reportSearchErrorId : undefined}
            className={`w-32 rounded px-2.5 py-1.5 text-[12.5px] ${REPORT_SEARCH_INPUT_CLASS}`}
            style={{ color: "var(--nx-text-primary)" }}
          />
          <button type="submit" className={`rounded border px-2.5 py-1.5 text-[12.5px] font-semibold ${BUTTON_SECONDARY}`} style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}>
            Buscar
          </button>
          {reportIdFilter !== null && (
            <button
              type="button"
              onClick={handleClearReportSearch}
              className={`text-[12.5px] underline ${BUTTON_TEXT}`}
              style={{ color: "var(--nx-text-muted)" }}
            >
              Limpiar
            </button>
          )}
        </form>

        {/* Descargar CSV - misma fuente/filtros/reportId que la tabla
            (exportQuery, ver AfterHoursShell.tsx), pero SIN paginar - el
            archivo cubre todo el universo filtrado, no solo esta página. */}
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className={`rounded border px-2.5 py-1.5 text-[12.5px] font-semibold ${BUTTON_PRIMARY}`}
          style={{ background: "var(--nx-accent-indigo, #4f46e5)", color: "#fff", borderColor: "transparent" }}
        >
          {exporting ? "Descargando…" : "Descargar CSV"}
        </button>

        {reportSearchError && (
          <span id={reportSearchErrorId} role="alert" className="w-full text-[12px]" style={{ color: "var(--nx-danger-fg, #c0392b)" }}>
            {reportSearchError}
          </span>
        )}
        {exportError && (
          <div role="alert" className="w-full">
            <ErrorBanner message={exportError} />
          </div>
        )}
      </div>

      {/* Escritorio (>= md) - tabla completa con scroll horizontal como
          respaldo, nunca como único mecanismo (ver tarjetas móviles abajo). */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1240px] border-collapse text-[13px]">
          <thead>
            <tr style={{ background: "var(--nx-page-bg)" }}>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className="px-3.5 py-2.5 text-left font-semibold whitespace-nowrap"
                  style={{ color: "var(--nx-text-secondary)" }}
                >
                  {col.sortKey ? (
                    <button type="button" onClick={() => onSortChange(col.sortKey!)} className={`inline-flex items-center gap-1 px-1 ${BUTTON_SORT}`}>
                      {col.label}
                      {sortBy === col.sortKey && <span aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {!loading && !error && rows.length > 0 && (
            <tbody>
              {rows.map(row => {
                const start = splitDateTime(row.analysis_start_time);
                const end = splitDateTime(row.analysis_end_time);
                const total = totalAfterHoursHours(row);
                const confidenceTier = getConfidenceTierLabel(row.confidence_label);
                const diagnosis = buildDiagnosis({
                  dataBasis: row.data_basis,
                  fallbackUsed: row.fallback_used,
                  coverageReasonCode: row.coverage_reason_code,
                  contractualReasonCode: row.contractual_reason_code
                });
                const selected = isAfterHoursRowSelected(row.fieldbeat_task_id, selectedTaskId);

                return (
                  <tr
                    key={row.fieldbeat_task_id}
                    onClick={() => onRowClick(row)}
                    aria-selected={selected}
                    data-selected={selected || undefined}
                    className="cursor-pointer border-b transition-colors hover:bg-[var(--nx-page-bg)]"
                    style={{
                      borderColor: "var(--nx-border)",
                      ...(selected ? { background: "var(--nx-row-selected-bg)", boxShadow: "inset 3px 0 0 var(--nx-row-selected-border)" } : undefined)
                    }}
                  >
                    <td className="px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }}>
                      {start.date}
                    </td>
                    <td className="px-3.5 py-2 [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
                      #{row.fieldbeat_task_id}
                    </td>
                    <td className="px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }}>
                      {row.assigned_to ?? "-"}
                      {/* HOTFIX auditoría After-Hours (§5): esta columna siempre
                          fue el responsable principal (assigned_to) únicamente -
                          nunca reparte horas por participante (ver
                          quality.fieldbeat_report_labor_summary, sql/088). El
                          indicador "+N" es solo informativo: declara que el
                          reporte tiene participantes adicionales sin implicar
                          que las horas de esta fila les pertenecen a ellos. */}
                      {row.participant_count !== null && row.participant_count > 1 && (
                        // WCAG SC 1.3.1 - `title` solo no es perceivable de forma
                        // confiable (lectores de pantalla/táctil no lo exponen
                        // consistentemente) - aria-label repite el mismo texto,
                        // nunca depende únicamente del hover del mouse.
                        <span
                          className="ml-1 text-[11px]"
                          style={{ color: "var(--nx-text-muted)" }}
                          title={`Reporte con ${row.participant_count} participantes (responsable principal + adicionales) - las horas de esta fila son de cobertura contractual del reporte, no se reparten por persona`}
                          aria-label={`Reporte con ${row.participant_count} participantes (responsable principal más adicionales) - las horas de esta fila son de cobertura contractual del reporte, no se reparten por persona`}
                        >
                          +{row.participant_count - 1}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }} title={row.client_name ?? ""}>
                      {row.client_name ?? "-"}
                    </td>
                    <td className="max-w-[180px] truncate px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }} title={row.equipment_internal_ids ?? ""}>
                      {row.equipment_internal_ids ?? "-"}
                    </td>
                    <td className="max-w-[160px] truncate px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }} title={row.model ?? ""}>
                      {formatModelCell(row.model, row as unknown as Record<string, unknown>)}
                    </td>
                    <td className="px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }}>
                      {row.task_type ?? "-"}
                    </td>
                    <td className="px-3.5 py-2 [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
                      {start.time}
                    </td>
                    <td className="px-3.5 py-2 [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
                      {end.time}
                    </td>
                    <td className="px-3.5 py-2 [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
                      {formatHoursOrDash(total)}
                    </td>
                    <td className="px-3.5 py-2">
                      <StatusBadge label={confidenceTier.label} tone={confidenceTier.severity} size="sm" />
                    </td>
                    <td className="px-3.5 py-2">
                      <StatusBadge label={diagnosis.primary.shortLabel} tone={diagnosis.primary.severity} size="sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>

      {/* Móvil (< md) - tarjetas (mismo patrón que ExplorerShell.tsx),
          nunca dependiente de scroll horizontal de 12 columnas. */}
      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-col gap-2.5 p-3 md:hidden">
          {rows.map(row => {
            const start = splitDateTime(row.analysis_start_time);
            const total = totalAfterHoursHours(row);
            const confidenceTier = getConfidenceTierLabel(row.confidence_label);
            const diagnosis = buildDiagnosis({
              dataBasis: row.data_basis,
              fallbackUsed: row.fallback_used,
              coverageReasonCode: row.coverage_reason_code,
              contractualReasonCode: row.contractual_reason_code
            });
            const selected = isAfterHoursRowSelected(row.fieldbeat_task_id, selectedTaskId);

            return (
              <button
                key={row.fieldbeat_task_id}
                type="button"
                onClick={() => onRowClick(row)}
                aria-pressed={selected}
                data-selected={selected || undefined}
                className="flex flex-col gap-1 rounded-[var(--nx-radius-card)] border p-3 text-left"
                style={{
                  borderColor: selected ? "var(--nx-row-selected-border)" : "var(--nx-border)",
                  background: selected ? "var(--nx-row-selected-bg)" : "var(--nx-card-bg)"
                }}
              >
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span style={{ color: "var(--nx-text-muted)" }}>{start.date}</span>
                  <span className="font-semibold [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
                    #{row.fieldbeat_task_id}
                  </span>
                </div>
                <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {row.client_name ?? "-"}
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span style={{ color: "var(--nx-text-secondary)" }}>{row.equipment_internal_ids ?? "-"}</span>
                  <span style={{ color: "var(--nx-text-secondary)" }}>{formatModelCell(row.model, row as unknown as Record<string, unknown>)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span style={{ color: "var(--nx-text-muted)" }}>{formatHoursOrDash(total)} fuera de horario</span>
                  <StatusBadge label={confidenceTier.label} tone={confidenceTier.severity} size="sm" />
                </div>
                <div>
                  <StatusBadge label={diagnosis.primary.shortLabel} tone={diagnosis.primary.severity} size="sm" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="border-t px-5 py-5" style={{ borderColor: "var(--nx-border)" }}>
          {SKELETON_WIDTHS.map((w, i) => (
            <div
              key={i}
              className="mb-2.5 h-4 rounded"
              style={{ width: `${w}%`, background: "linear-gradient(90deg,var(--nx-page-bg),var(--nx-card-bg),var(--nx-page-bg))", animation: "nx-pulse 1.4s ease-in-out infinite" }}
            />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="border-t" style={{ borderColor: "var(--nx-border)" }}>
          <AfterHoursEmptyBlock tone="error" title="No se pudo cargar el detalle" description="Intenta nuevamente en unos minutos." />
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="border-t" style={{ borderColor: "var(--nx-border)" }}>
          {reportIdFilter !== null ? (
            <AfterHoursEmptyBlock
              title={`No se encontró el reporte #${reportIdFilter}`}
              description="El reporte no pertenece a los registros fuera de horario o no cumple los demás filtros activos."
            />
          ) : (
            <AfterHoursEmptyBlock title="Sin registros para este filtro" description="Ajusta los filtros aplicados para ver resultados." />
          )}
        </div>
      )}

      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-end gap-3 border-t px-4.5 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <span className="text-[12.5px]" style={{ color: "var(--nx-text-muted)" }}>
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className={`rounded border px-2 py-1 text-[12.5px] ${BUTTON_PAGINATION}`}
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
          >
            ‹ Anterior
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className={`rounded border px-2 py-1 text-[12.5px] ${BUTTON_PAGINATION}`}
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
          >
            Siguiente ›
          </button>
        </div>
      )}
      <div className="border-t px-4.5 py-2.5 text-[12.5px]" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" }}>
        Niveles de clasificación: Alta confianza · Confianza media · Baja confianza · Insuficiente · Sin información.
      </div>
    </div>
  );
}
