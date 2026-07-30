"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import { PartAliasCorrectionDrawer } from "./PartAliasCorrectionDrawer";
import type { AmbiguousPartRow, PaginatedResponse } from "@/types/audit";

interface AmbiguousPartsSectionProps {
  clientes: string[];
  maquinas: string[];
  /** Ver PartsReviewSection.tsx - misma capacidad (correction:part-alias),
   * misma razón para reflejar el rol acá en vez de asumirlo. */
  role: "gerencia" | "administracion";
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Pestaña "Coincidencias que requieren decisión" (antes "Matches ambiguos")
// - ver docs/MANUAL_REVIEW_VIEW.md § B. Fuente:
// marts.used_parts_dolibarr_match WHERE match_status = 'AMBIGUOUS_MATCH',
// agrupado por identificador crudo. Nunca muestra la lista concatenada de
// IDs de candidatos Dolibarr en la tabla principal (sección 5/6 de la
// corrección de negocio) - esa señal técnica vive en el drawer de
// corrección, no en la bandeja de decisión.
export function AmbiguousPartsSection({ clientes, maquinas, role }: AmbiguousPartsSectionProps) {
  const [filters, setFilters] = useState<AuditFilterValues>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<AmbiguousPartRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correctionRow, setCorrectionRow] = useState<AmbiguousPartRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function refetch() {
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
        searchPlaceholder="Buscar identificador o nombre…"
      />

      <ResponsiveTableShell
        title="Coincidencias que requieren decisión"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin coincidencias ambiguas para este filtro."
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
              <th className="text-left">Repuesto declarado</th>
              <th className="text-left">Alcance</th>
              <th className="text-left">Hallazgo</th>
              <th className="text-left">Recomendación</th>
              <th className="text-left">Acción</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => (
              <tr key={row.raw_part_identifier}>
                <td style={{ whiteSpace: "normal" }}>
                  <div style={{ color: "var(--nx-text-primary)" }}>{row.part_name ?? row.raw_part_identifier}</div>
                  <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    {row.raw_part_identifier}
                  </div>
                </td>
                <td className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.occurrences.toLocaleString("es-CL")} ocurrencia{row.occurrences === 1 ? "" : "s"} · {row.clientes_afectados.toLocaleString("es-CL")} cliente
                  {row.clientes_afectados === 1 ? "" : "s"} · {row.equipos_afectados.toLocaleString("es-CL")} equipo{row.equipos_afectados === 1 ? "" : "s"}
                </td>
                <td>
                  <StatusBadge label="Varias coincidencias posibles" tone="warning" size="sm" />
                </td>
                <td style={{ whiteSpace: "normal", color: "var(--nx-text-primary)" }}>Elegir el producto correcto entre los candidatos sugeridos.</td>
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
                      Revisar opciones
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Requiere rol Administración"
                      className="cursor-not-allowed whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-page-bg)" }}
                    >
                      Revisar opciones
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => (
            <div key={row.raw_part_identifier} className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {row.part_name ?? row.raw_part_identifier}
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.raw_part_identifier}
                </div>
              </div>
              <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {row.occurrences.toLocaleString("es-CL")} ocurrencias · {row.clientes_afectados.toLocaleString("es-CL")} clientes · {row.equipos_afectados.toLocaleString("es-CL")} equipos
              </div>
              <StatusBadge label="Varias coincidencias posibles" tone="warning" size="sm" />
              <div className="text-sm" style={{ color: "var(--nx-text-primary)" }}>
                Elegir el producto correcto entre los candidatos sugeridos.
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
                  Revisar opciones
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Requiere rol Administración"
                  className="w-full cursor-not-allowed rounded-full border px-3 py-1.5 text-xs font-semibold"
                  style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-page-bg)" }}
                >
                  Revisar opciones
                </button>
              )}
            </div>
          ))}
        </div>
      </ResponsiveTableShell>

      <PartAliasCorrectionDrawer open={drawerOpen} row={correctionRow} onClose={() => setDrawerOpen(false)} onApplied={refetch} />
    </div>
  );
}
