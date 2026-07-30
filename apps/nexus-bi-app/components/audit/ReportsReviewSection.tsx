"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, reportQualityBadge, zendeskJoinBadge } from "@/components/ui/StatusBadge";
import { FutureActionButton } from "./FutureActionButton";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { PaginatedResponse, ReportReviewRow } from "@/types/audit";

interface ReportsReviewSectionProps {
  clientes: string[];
  maquinas: string[];
}

const REPORT_QUALITY_OPTIONS = ["HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED"];

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

function reportRecommendation(row: ReportReviewRow): string {
  if (row.review_required_used_parts_count > 0) {
    return `Revisar ${row.review_required_used_parts_count} repuesto${row.review_required_used_parts_count === 1 ? "" : "s"} declarado${row.review_required_used_parts_count === 1 ? "" : "s"} en este reporte desde "Repuestos sin identificar".`;
  }
  return "Revisar el reporte y completar la información faltante.";
}

// Pestaña "Reportes con información pendiente" (antes "Reportes con
// revisión requerida") - ver docs/MANUAL_REVIEW_VIEW.md § D. Fuente:
// marts.fieldbeat_report_dolibarr_operational_view. Contexto de negocio
// (cliente/equipo/fecha/tipo/técnico) combinado en una sola columna en vez
// de 5 columnas separadas de igual peso visual - sección 5 de la corrección
// de negocio de Auditoría.
export function ReportsReviewSection({ clientes, maquinas }: ReportsReviewSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues & { reportQuality?: string }>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<ReportReviewRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({ page: String(page), pageSize: "20", ...filters });
    fetch(`/api/audit/reports-review?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [filters, page]);

  return (
    <div className="flex flex-col gap-3">
      <AuditFilterBar
        clientes={clientes}
        maquinas={maquinas}
        values={filters}
        onChange={(key, value) => {
          setFilters(prev => ({ ...prev, [key]: value || undefined }));
          setPage(1);
        }}
        onClear={() => {
          setFilters({});
          setPage(1);
        }}
        searchPlaceholder="Buscar cliente, máquina o técnico…"
        extra={
          <label className="flex flex-col gap-1 text-xs">
            <span style={{ color: "var(--nx-text-secondary)" }}>Tipo de problema</span>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", color: "var(--nx-text-primary)" }}
              value={filters.reportQuality ?? ""}
              onChange={event => setFilters(prev => ({ ...prev, reportQuality: event.target.value || undefined }))}
            >
              <option value="">Todos</option>
              {REPORT_QUALITY_OPTIONS.map(s => (
                <option key={s} value={s}>
                  {reportQualityBadge(s).label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <ResponsiveTableShell
        title="Reportes con información pendiente"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin reportes pendientes de revisión para este filtro."
        footer={
          data && (
            <>
              <span>
                Página {data.page} de {data.totalPages}
              </span>
              <button type="button" onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="rounded border px-2" style={{ borderColor: "var(--nx-border)" }}>
                ‹
              </button>
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.totalPages}
                className="rounded border px-2"
                style={{ borderColor: "var(--nx-border)" }}
              >
                ›
              </button>
            </>
          )
        }
      >
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr>
              <th className="text-left">Reporte</th>
              <th className="text-left">Contexto</th>
              <th className="text-left">Hallazgo</th>
              <th className="text-left">Recomendación</th>
              <th className="text-left">Acción</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const quality = reportQualityBadge(row.report_quality_status);
              const join = zendeskJoinBadge(row.zendesk_join_status);
              return (
                <tr key={row.fieldbeat_task_id}>
                  <td>Reporte {row.fieldbeat_task_id}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <div style={{ color: "var(--nx-text-primary)" }}>{row.client_name ?? "-"}</div>
                    <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                      {[row.equipment_internal_ids, row.task_type, row.fieldbeat_task_date?.slice(0, 10)].filter(Boolean).join(" · ") || "-"}
                      {row.technician_names ? ` · ${row.technician_names}` : ""}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge label={quality.label} tone={quality.tone} size="sm" />
                      <StatusBadge label={join.label} tone={join.tone} size="sm" />
                    </div>
                  </td>
                  <td style={{ whiteSpace: "normal", color: "var(--nx-text-primary)" }}>{reportRecommendation(row)}</td>
                  <td>
                    <FutureActionButton
                      label="Marcar revisado"
                      reason="No existe un comando de gobierno para 'marcar reporte revisado' - usa la Bandeja de incidencias para revisar/descartar los problemas concretos de este reporte."
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => {
            const quality = reportQualityBadge(row.report_quality_status);
            const join = zendeskJoinBadge(row.zendesk_join_status);
            return (
              <div key={row.fieldbeat_task_id} className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                      Reporte {row.fieldbeat_task_id}
                    </div>
                    <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                      {row.client_name ?? "-"}
                    </div>
                  </div>
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {[row.equipment_internal_ids, row.task_type, row.fieldbeat_task_date?.slice(0, 10)].filter(Boolean).join(" · ") || "-"}
                  {row.technician_names ? ` · ${row.technician_names}` : ""}
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge label={quality.label} tone={quality.tone} size="sm" />
                  <StatusBadge label={join.label} tone={join.tone} size="sm" />
                </div>
                <div className="text-sm" style={{ color: "var(--nx-text-primary)" }}>
                  {reportRecommendation(row)}
                </div>
                <FutureActionButton
                  label="Marcar revisado"
                  reason="No existe un comando de gobierno para 'marcar reporte revisado' - usa la Bandeja de incidencias para revisar/descartar los problemas concretos de este reporte."
                />
              </div>
            );
          })}
        </div>
      </ResponsiveTableShell>
    </div>
  );
}
