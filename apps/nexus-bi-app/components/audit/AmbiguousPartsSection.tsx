"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { FutureActionButton } from "./FutureActionButton";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { AmbiguousPartRow, PaginatedResponse } from "@/types/audit";

interface AmbiguousPartsSectionProps {
  clientes: string[];
  maquinas: string[];
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Pestaña "Matches ambiguos" - ver docs/MANUAL_REVIEW_VIEW.md § B.
// Fuente: marts.used_parts_dolibarr_match WHERE match_status =
// 'AMBIGUOUS_MATCH', agrupado por identificador crudo.
export function AmbiguousPartsSection({ clientes, maquinas }: AmbiguousPartsSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<AmbiguousPartRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({ page: String(page), pageSize: "20", ...filters });
    fetch(`/api/audit/ambiguous-parts?${query}`)
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
        searchPlaceholder="Buscar identificador o nombre…"
      />

      <ResponsiveTableShell
        title="Matches ambiguos"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin matches ambiguos para este filtro."
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
              <th>Identificador crudo</th>
              <th>Nombre repuesto</th>
              <th>Candidatos Dolibarr</th>
              <th>Ocurrencias</th>
              <th>Clientes afectados</th>
              <th>Equipos afectados</th>
              <th>Acción sugerida</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => (
              <tr key={row.raw_part_identifier}>
                <td title={row.raw_part_identifier}>{row.raw_part_identifier}</td>
                <td title={row.part_name ?? ""}>{row.part_name ?? "-"}</td>
                <td title={row.candidate_dolibarr_product_ids ?? ""}>{row.candidate_dolibarr_product_ids ?? "-"}</td>
                <td>{row.occurrences.toLocaleString("es-CL")}</td>
                <td>{row.clientes_afectados.toLocaleString("es-CL")}</td>
                <td>{row.equipos_afectados.toLocaleString("es-CL")}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span style={{ color: "var(--text-secondary)" }}>Elegir producto candidato correcto</span>
                    <FutureActionButton label="Elegir candidato" />
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
