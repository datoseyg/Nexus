"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TicketLinkCorrectionDrawer } from "./TicketLinkCorrectionDrawer";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { PaginatedResponse, TicketLinkReviewRow } from "@/types/audit";

interface TicketLinksReviewSectionProps {
  clientes: string[];
  maquinas: string[];
  role: "gerencia" | "administracion";
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

function contextLine(row: TicketLinkReviewRow): string {
  return [row.equipment_internal_ids, row.task_type, row.fieldbeat_task_date?.slice(0, 10), row.technician_names].filter(Boolean).join(" · ") || "-";
}

// Pestaña "Tickets sin vincular" (antes "Tickets faltantes o restringidos")
// - ver docs/MANUAL_REVIEW_VIEW.md § E. Fuente:
// marts.fieldbeat_report_dolibarr_operational_view WHERE
// zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'. No
// confundir con los tickets Zendesk 403 (sin acceso por token) - estos son
// reportes FieldBeat cuyo ticket vinculado no está entre los minados. El
// hallazgo es el mismo para toda la lista (por eso el filtro server-side ya
// la acota) - se muestra igual como badge explícito, nunca como el nombre
// de la pestaña por defecto.
export function TicketLinksReviewSection({ clientes, maquinas, role }: TicketLinksReviewSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<TicketLinkReviewRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correctionRow, setCorrectionRow] = useState<TicketLinkReviewRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function refetch() {
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
  }

  useEffect(refetch, [filters, page]);

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
        searchPlaceholder="Buscar cliente, máquina o ID de ticket…"
      />

      <ResponsiveTableShell
        title="Tickets sin vincular"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin reportes con ticket faltante o restringido para este filtro."
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
            {data?.rows.map(row => (
              <tr key={row.fieldbeat_task_id}>
                <td>
                  <div style={{ color: "var(--nx-text-primary)" }}>Reporte {row.fieldbeat_task_id}</div>
                  <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    {row.client_name ?? "-"}
                  </div>
                </td>
                <td className="text-xs" style={{ whiteSpace: "normal", color: "var(--nx-text-secondary)" }}>
                  {contextLine(row)}
                  {row.linked_zendesk_ticket_id ? ` · Ticket ${row.linked_zendesk_ticket_id}` : ""}
                </td>
                <td>
                  <StatusBadge label="Ticket faltante o no disponible" tone="danger" size="sm" />
                </td>
                <td style={{ whiteSpace: "normal", color: "var(--nx-text-primary)" }}>Confirmar si existe un ticket asociado o registrar que no corresponde.</td>
                <td>
                  {role === "administracion" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCorrectionRow(row);
                        setDrawerOpen(true);
                      }}
                      className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                      style={{ background: "var(--nx-accent-indigo)" }}
                    >
                      Resolver
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Requiere rol Administración"
                      className="cursor-not-allowed whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-page-bg)" }}
                    >
                      Resolver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => (
            <div key={row.fieldbeat_task_id} className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  Reporte {row.fieldbeat_task_id}
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.client_name ?? "-"}
                </div>
              </div>
              <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {contextLine(row)}
                {row.linked_zendesk_ticket_id ? ` · Ticket ${row.linked_zendesk_ticket_id}` : ""}
              </div>
              <StatusBadge label="Ticket faltante o no disponible" tone="danger" size="sm" />
              <div className="text-sm" style={{ color: "var(--nx-text-primary)" }}>
                Confirmar si existe un ticket asociado o registrar que no corresponde.
              </div>
              {role === "administracion" ? (
                <button
                  type="button"
                  onClick={() => {
                    setCorrectionRow(row);
                    setDrawerOpen(true);
                  }}
                  className="w-full rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "var(--nx-accent-indigo)" }}
                >
                  Resolver
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Requiere rol Administración"
                  className="w-full cursor-not-allowed rounded-full border px-3 py-1.5 text-xs font-semibold"
                  style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-page-bg)" }}
                >
                  Resolver
                </button>
              )}
            </div>
          ))}
        </div>
      </ResponsiveTableShell>

      <TicketLinkCorrectionDrawer open={drawerOpen} row={correctionRow} onClose={() => setDrawerOpen(false)} onApplied={refetch} />
    </div>
  );
}
