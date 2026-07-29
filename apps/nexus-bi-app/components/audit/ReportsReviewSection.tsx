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

// Pestaña "Reportes con revisión requerida" - ver
// docs/MANUAL_REVIEW_VIEW.md § D. Fuente:
// marts.fieldbeat_report_dolibarr_operational_view.
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
    <div>
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
          <select
            className="rounded border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", color: "var(--text-primary)" }}
            value={filters.reportQuality ?? ""}
            onChange={event => setFilters(prev => ({ ...prev, reportQuality: event.target.value || undefined }))}
          >
            <option value="">Estado de calidad (todos)</option>
            {REPORT_QUALITY_OPTIONS.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
      />

      <ResponsiveTableShell
        title="Reportes con revisión requerida"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin reportes pendientes de revisión para este filtro."
        maxHeight={480}
        footer={
          data && (
            <>
              <span>
                Página {data.page} de {data.totalPages}
              </span>
              <button type="button" onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="rounded border px-2" style={{ borderColor: "var(--eyg-border)" }}>
                ‹
              </button>
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.totalPages}
                className="rounded border px-2"
                style={{ borderColor: "var(--eyg-border)" }}
              >
                ›
              </button>
            </>
          )
        }
      >
        <table>
          <thead>
            <tr>
              <th>Tarea</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Máquina</th>
              <th>Tipo</th>
              <th>Técnico</th>
              <th>Repuestos</th>
              <th>Por revisar</th>
              <th>Calidad</th>
              <th>Ticket</th>
              <th>Vínculo Zendesk</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const quality = reportQualityBadge(row.report_quality_status);
              const join = zendeskJoinBadge(row.zendesk_join_status);
              return (
                <tr key={row.fieldbeat_task_id}>
                  <td>{row.fieldbeat_task_id}</td>
                  <td>{row.fieldbeat_task_date?.slice(0, 10) ?? "-"}</td>
                  <td title={row.client_name ?? ""}>{row.client_name ?? "-"}</td>
                  <td title={row.equipment_internal_ids ?? ""}>{row.equipment_internal_ids ?? "-"}</td>
                  <td>{row.task_type ?? "-"}</td>
                  <td title={row.technician_names ?? ""}>{row.technician_names ?? "-"}</td>
                  <td>{row.used_parts_count}</td>
                  <td>{row.review_required_used_parts_count}</td>
                  <td>
                    <StatusBadge label={quality.label} tone={quality.tone} />
                  </td>
                  <td>{row.linked_zendesk_ticket_id ?? "-"}</td>
                  <td>
                    <StatusBadge label={join.label} tone={join.tone} />
                  </td>
                  <td>
                    <FutureActionButton
                      label="Marcar revisado"
                      reason="No existe un comando de gobierno para 'marcar reporte revisado' - fuera del catálogo de comandos diseñado (Gate B B8). Usa la Bandeja de incidencias para revisar/descartar los problemas concretos de este reporte."
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ResponsiveTableShell>
    </div>
  );
}
