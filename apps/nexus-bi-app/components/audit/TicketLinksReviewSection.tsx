"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, reportQualityBadge } from "@/components/ui/StatusBadge";
import { FutureActionButton } from "./FutureActionButton";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { PaginatedResponse, TicketLinkReviewRow } from "@/types/audit";

interface TicketLinksReviewSectionProps {
  clientes: string[];
  maquinas: string[];
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Pestaña "Tickets faltantes o restringidos" — ver
// docs/MANUAL_REVIEW_VIEW.md § E. Fuente:
// marts.fieldbeat_report_dolibarr_operational_view WHERE
// zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK' (920
// reportes reales). No confundir con los 291 tickets 403 — esos son
// tickets Zendesk sin acceso por token; estos son reportes FieldBeat cuyo
// ticket vinculado no está entre los 628 tickets minados.
export function TicketLinksReviewSection({ clientes, maquinas }: TicketLinksReviewSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<TicketLinkReviewRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({ page: String(page), pageSize: "20", ...filters });
    fetch(`/api/audit/ticket-links-review?${query}`)
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
        searchPlaceholder="Buscar cliente, máquina o ID de ticket…"
      />

      <ResponsiveTableShell
        title="Tickets faltantes o restringidos"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin reportes con ticket faltante o restringido para este filtro."
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
              <th>ID Ticket vinculado</th>
              <th>Tipo</th>
              <th>Técnico</th>
              <th>Repuestos usados</th>
              <th>Calidad</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const quality = reportQualityBadge(row.report_quality_status);
              return (
                <tr key={row.fieldbeat_task_id}>
                  <td>{row.fieldbeat_task_id}</td>
                  <td>{row.fieldbeat_task_date?.slice(0, 10) ?? "—"}</td>
                  <td title={row.client_name ?? ""}>{row.client_name ?? "—"}</td>
                  <td title={row.equipment_internal_ids ?? ""}>{row.equipment_internal_ids ?? "—"}</td>
                  <td>{row.linked_zendesk_ticket_id ?? "—"}</td>
                  <td>{row.task_type ?? "—"}</td>
                  <td title={row.technician_names ?? ""}>{row.technician_names ?? "—"}</td>
                  <td>{row.used_parts_count}</td>
                  <td>
                    <StatusBadge label={quality.label} tone={quality.tone} />
                  </td>
                  <td>
                    <FutureActionButton label="Corregir ticket" />
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
