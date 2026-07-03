"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { MiniBarTableCell } from "@/components/dashboard/MiniBarTableCell";
import { FutureActionButton } from "./FutureActionButton";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { PaginatedResponse, PlaceholderGroupRow } from "@/types/audit";

interface PlaceholdersSectionProps {
  clientes: string[];
  maquinas: string[];
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Pestaña "Placeholders / valores no informativos" — ver
// docs/MANUAL_REVIEW_VIEW.md § C. Fuente: marts.used_parts_dolibarr_match
// WHERE match_status = 'PLACEHOLDER_VALUE', agrupado por identificador
// crudo normalizado — el objetivo es ver cuáles son los valores basura
// más frecuentes (N/A, NO HAY, S/N, --, etc.) reales del pipeline.
export function PlaceholdersSection({ clientes, maquinas }: PlaceholdersSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<PlaceholderGroupRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({ page: String(page), pageSize: "20", ...filters });
    fetch(`/api/audit/placeholders?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [filters, page]);

  const maxOccurrences = data?.rows[0]?.occurrences ?? 1;

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
        searchPlaceholder="Buscar valor placeholder…"
      />

      <ResponsiveTableShell
        title="Placeholders / valores no informativos"
        count={data?.totalRows}
        countLabel="valores distintos"
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin placeholders para este filtro."
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
              <th>Valor crudo</th>
              <th>Ejemplo de nombre de repuesto</th>
              <th>Ocurrencias</th>
              <th>Acción sugerida</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => (
              <tr key={row.raw_part_identifier}>
                <td title={row.raw_part_identifier}>{row.raw_part_identifier}</td>
                <td title={row.part_name_sample ?? ""}>{row.part_name_sample ?? "—"}</td>
                <td>
                  <MiniBarTableCell value={row.occurrences} max={maxOccurrences} />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span style={{ color: "var(--text-secondary)" }}>Marcar como placeholder válido o crear regla de exclusión</span>
                    <FutureActionButton label="Confirmar" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableShell>
    </div>
  );
}
