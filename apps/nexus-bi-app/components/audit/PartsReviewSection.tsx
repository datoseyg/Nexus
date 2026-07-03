"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, matchStatusBadge } from "@/components/ui/StatusBadge";
import { FutureActionButton } from "./FutureActionButton";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { PaginatedResponse, PartsReviewRow } from "@/types/audit";

interface PartsReviewSectionProps {
  clientes: string[];
  maquinas: string[];
}

const MATCH_STATUS_OPTIONS = ["NO_MATCH", "AMBIGUOUS_MATCH", "PLACEHOLDER_VALUE", "MATCHED"];

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Pestaña "Repuestos por revisar" — ver docs/MANUAL_REVIEW_VIEW.md § A.
// Criterio: needs_manual_review = true OR match_status IN (NO_MATCH,
// AMBIGUOUS_MATCH, PLACEHOLDER_VALUE). Solo lectura + acción sugerida por
// fila; los botones de acción están deshabilitados (ver
// FutureActionButton) hasta que exista el Centro de Correcciones.
export function PartsReviewSection({ clientes, maquinas }: PartsReviewSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues & { matchStatus?: string }>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<PartsReviewRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({ page: String(page), pageSize: "20", ...filters });
    fetch(`/api/audit/parts-review?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [filters, page]);

  function handleChange(key: keyof AuditFilterValues, value: string) {
    setFilters(prev => ({ ...prev, [key]: value || undefined }));
    setPage(1);
  }

  return (
    <div>
      <AuditFilterBar
        clientes={clientes}
        maquinas={maquinas}
        values={filters}
        onChange={handleChange}
        onClear={() => {
          setFilters({});
          setPage(1);
        }}
        searchPlaceholder="Buscar identificador o nombre de repuesto…"
        extra={
          <select
            className="rounded border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", color: "var(--text-primary)" }}
            value={filters.matchStatus ?? ""}
            onChange={event => setFilters(prev => ({ ...prev, matchStatus: event.target.value || undefined }))}
          >
            <option value="">Match status (todos)</option>
            {MATCH_STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
      />

      <ResponsiveTableShell
        title="Repuestos por revisar"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin repuestos pendientes de revisión para este filtro."
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
              <th>Identificador crudo</th>
              <th>Nombre repuesto</th>
              <th>Cant.</th>
              <th>Match</th>
              <th>Método</th>
              <th>Confianza</th>
              <th>Candidatos</th>
              <th>Ref. Dolibarr</th>
              <th>Acción sugerida</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const badge = matchStatusBadge(row.match_status);
              return (
                <tr key={row.used_part_id}>
                  <td>{row.fieldbeat_task_id}</td>
                  <td>{row.fieldbeat_task_date?.slice(0, 10) ?? "—"}</td>
                  <td title={row.client_name ?? ""}>{row.client_name ?? "—"}</td>
                  <td title={row.equipment_internal_ids ?? ""}>{row.equipment_internal_ids ?? "—"}</td>
                  <td title={row.raw_part_identifier ?? ""}>{row.raw_part_identifier ?? "—"}</td>
                  <td title={row.part_name ?? ""}>{row.part_name ?? "—"}</td>
                  <td>{row.quantity ?? "—"}</td>
                  <td>
                    <StatusBadge label={badge.label} tone={badge.tone} />
                  </td>
                  <td>{row.match_method ?? "—"}</td>
                  <td>{row.match_confidence ?? "—"}</td>
                  <td title={row.candidate_dolibarr_product_ids ?? ""}>{row.candidate_dolibarr_product_ids ?? "—"}</td>
                  <td>{row.dolibarr_ref ?? "—"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span style={{ color: "var(--text-secondary)" }}>{row.suggested_action}</span>
                      <FutureActionButton label="Resolver" />
                    </div>
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
