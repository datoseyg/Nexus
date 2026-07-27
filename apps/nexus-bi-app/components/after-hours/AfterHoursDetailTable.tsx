"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { buildDiagnosis, getConfidenceTierLabel } from "@/lib/after-hours-labels";
import { formatHoursOrDash, splitDateTime, totalAfterHoursHours } from "@/lib/after-hours-detail-view";
import type { AfterHoursDetailRow } from "@/types/after-hours";

export type DetailSortColumn = "start_time" | "duration" | "after_hours_rate" | "confidence_score";
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
}

const COLUMNS: Array<{ key: string; label: string; sortKey?: DetailSortColumn }> = [
  { key: "date", label: "Fecha", sortKey: "start_time" },
  { key: "technician", label: "Técnico" },
  { key: "client", label: "Cliente" },
  { key: "equipment", label: "Equipo" },
  { key: "taskType", label: "Tipo de tarea" },
  { key: "start", label: "Inicio" },
  { key: "end", label: "Término" },
  { key: "afterHours", label: "Tiempo fuera de horario", sortKey: "duration" },
  { key: "confidence", label: "Confianza", sortKey: "confidence_score" },
  { key: "diagnosis", label: "Diagnóstico" }
];

const SKELETON_WIDTHS = [90, 75, 85, 60, 80];

// Tabla "Registros detectados fuera de horario" (ETAPA 6.6D §11) -
// columnas del prototipo + Diagnóstico (traduce data_basis/fallback_used/
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
  onRowClick
}: AfterHoursDetailTableProps) {
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
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-[13px]">
          <thead>
            <tr style={{ background: "var(--nx-page-bg)" }}>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className="px-3.5 py-2.5 text-left font-semibold whitespace-nowrap"
                  style={{ color: "var(--nx-text-secondary)" }}
                >
                  {col.sortKey ? (
                    <button type="button" onClick={() => onSortChange(col.sortKey!)} className="inline-flex items-center gap-1">
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
                const start = splitDateTime(row.start_time);
                const end = splitDateTime(row.estimated_end_time);
                const total = totalAfterHoursHours(row);
                const confidenceTier = getConfidenceTierLabel(row.confidence_label);
                const diagnosis = buildDiagnosis({
                  dataBasis: row.data_basis,
                  fallbackUsed: row.fallback_used,
                  coverageReasonCode: row.coverage_reason_code,
                  contractualReasonCode: row.contractual_reason_code
                });

                return (
                  <tr
                    key={row.fieldbeat_task_id}
                    onClick={() => onRowClick(row)}
                    className="cursor-pointer border-b"
                    style={{ borderColor: "var(--nx-border)" }}
                  >
                    <td className="px-3.5 py-2" style={{ color: "var(--nx-text-primary)" }}>
                      {start.date}
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
          <AfterHoursEmptyBlock title="Sin registros para este filtro" description="Ajusta los filtros aplicados para ver resultados." />
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
            className="rounded border px-2 py-1 text-[12.5px] disabled:opacity-40"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
          >
            ‹ Anterior
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded border px-2 py-1 text-[12.5px] disabled:opacity-40"
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
