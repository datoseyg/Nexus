"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, matchStatusBadge } from "@/components/ui/StatusBadge";
import { matchStatusFinding, matchStatusRecommendation } from "@/lib/audit-vocabulary";
import { PartAliasCorrectionDrawer } from "./PartAliasCorrectionDrawer";
import { AuditFilterBar, type AuditFilterValues } from "./AuditFilterBar";
import type { PaginatedResponse, PartsReviewRow } from "@/types/audit";
import { hasCapability } from "@/lib/auth/capabilities-shared";

interface PartsReviewSectionProps {
  clientes: string[];
  maquinas: string[];
  role: "gerencia" | "administracion";
  /** Determina si el botón de corrección está activo (capacidad
   * correction:part-alias) o simplemente no se ofrece (solo lectura). La
   * autorización real sigue siendo server-side (requireCapability + rol de
   * conexión PostgreSQL) - esto es solo reflejo de permisos en la UI, nunca
   * su único control. */
  capabilities: string[];
}

const MATCH_STATUS_OPTIONS = ["NO_MATCH", "AMBIGUOUS_MATCH", "PLACEHOLDER_VALUE", "MATCHED"];

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

function contextLine(row: PartsReviewRow): string {
  const parts = [row.equipment_internal_ids, row.fieldbeat_task_id ? `Reporte ${row.fieldbeat_task_id}` : null, row.fieldbeat_task_date?.slice(0, 10)].filter(Boolean);
  return parts.join(" · ") || "-";
}

// Botón de acción de la fila - abre el drawer de corrección gobernada
// (correction:part-alias) para roles con capacidad; en modo lectura muestra
// el mismo texto de acción, deshabilitado con el motivo. El label del botón
// es contextual a la recomendación real (Resolver/Revisar opciones/
// Confirmar/Validar) - nunca "Resolver" genérico para las cuatro
// situaciones distintas (sección 5/6 de la corrección de negocio).
function RowAction({ actionLabel, canAct, onOpen }: { actionLabel: string; canAct: boolean; onOpen: () => void }) {
  if (!canAct) {
    return (
      <button
        type="button"
        disabled
        title="Requiere capacidad correction:part-alias"
        className="w-full cursor-not-allowed whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold sm:w-auto"
        style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-page-bg)" }}
      >
        {actionLabel}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-white sm:w-auto"
      style={{ background: "var(--nx-accent-indigo)" }}
    >
      {actionLabel}
    </button>
  );
}

// Pestaña "Repuestos por revisar" - ver docs/MANUAL_REVIEW_VIEW.md § A.
// Criterio: needs_manual_review = true OR match_status IN (NO_MATCH,
// AMBIGUOUS_MATCH, PLACEHOLDER_VALUE). "Resolver" ya escribe de forma
// gobernada (correction:part-alias, PartAliasCorrectionDrawer) - conectado
// desde la Familia 1 de Gate B.
//
// Composición orientada a decisión (corrección de negocio): la tabla nunca
// intenta mostrar las 12 columnas técnicas crudas (método/confianza/
// candidatos/ref. Dolibarr) como si fueran de igual importancia que la
// recomendación - esas viven en el drawer (PartAliasCorrectionDrawer). Las
// 6 columnas visibles responden directamente qué ocurrió, dónde, qué hacer,
// cuál es el estado y cómo actuar.
export function PartsReviewSection({ clientes, maquinas, capabilities }: PartsReviewSectionProps) {
  const canAct = hasCapability(capabilities, "correction:part-alias");
  const [filters, setFilters] = useState<AuditFilterValues & { matchStatus?: string }>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<PartsReviewRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correctionRow, setCorrectionRow] = useState<PartsReviewRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function refetch() {
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
  }

  useEffect(refetch, [filters, page]);

  function handleChange(key: keyof AuditFilterValues, value: string) {
    setFilters(prev => ({ ...prev, [key]: value || undefined }));
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-3">
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
          <label className="flex flex-col gap-1 text-xs">
            <span style={{ color: "var(--nx-text-secondary)" }}>Tipo de problema</span>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", color: "var(--nx-text-primary)" }}
              value={filters.matchStatus ?? ""}
              onChange={event => setFilters(prev => ({ ...prev, matchStatus: event.target.value || undefined }))}
            >
              <option value="">Todos</option>
              {MATCH_STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>
                  {matchStatusFinding(s)}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <ResponsiveTableShell
        title="Repuestos por revisar"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin repuestos pendientes de revisión para este filtro."
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
        {/* Tabla - escritorio/tablet. 6 columnas de decisión (nunca las 12
            técnicas crudas) para que quepan sin scroll horizontal a
            1366x768 y la recomendación/acción queden siempre visibles. */}
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr>
              <th className="text-left">Repuesto declarado</th>
              <th className="text-left">Contexto</th>
              <th className="text-left">Hallazgo</th>
              <th className="text-left">Recomendación</th>
              <th className="text-left">Estado</th>
              <th className="text-left">Acción</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const findingTone = matchStatusBadge(row.match_status).tone;
              const rec = matchStatusRecommendation(row.match_status);
              return (
                <tr key={row.used_part_id}>
                  <td style={{ whiteSpace: "normal" }}>
                    <div style={{ color: "var(--nx-text-primary)" }}>{row.part_name ?? row.raw_part_identifier ?? "N/A"}</div>
                    <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                      {row.raw_part_identifier ?? "-"}
                      {row.quantity ? ` · cant. ${row.quantity}` : ""}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "normal" }}>
                    <div style={{ color: "var(--nx-text-primary)" }}>{row.client_name ?? "-"}</div>
                    <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                      {contextLine(row)}
                    </div>
                  </td>
                  <td>
                    <StatusBadge label={matchStatusFinding(row.match_status)} tone={findingTone} size="sm" />
                  </td>
                  <td style={{ whiteSpace: "normal", color: "var(--nx-text-primary)" }}>{rec.text}</td>
                  <td>
                    <StatusBadge label="Pendiente" tone="warning" size="sm" />
                  </td>
                  <td>
                    <RowAction
                      actionLabel={rec.actionLabel}
                      canAct={canAct}
                      onOpen={() => {
                        setCorrectionRow(row);
                        setDrawerOpen(true);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Tarjetas - vista real en mobile (< md). */}
        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => {
            const findingTone = matchStatusBadge(row.match_status).tone;
            const rec = matchStatusRecommendation(row.match_status);
            return (
              <div key={row.used_part_id} className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                      {row.part_name ?? row.raw_part_identifier ?? "N/A"}
                    </div>
                    <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                      {row.raw_part_identifier ?? "-"}
                      {row.quantity ? ` · cant. ${row.quantity}` : ""}
                    </div>
                  </div>
                  <StatusBadge label="Pendiente" tone="warning" size="sm" />
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.client_name ?? "-"} · {contextLine(row)}
                </div>
                <StatusBadge label={matchStatusFinding(row.match_status)} tone={findingTone} size="sm" />
                <div className="text-sm" style={{ color: "var(--nx-text-primary)" }}>
                  {rec.text}
                </div>
                <RowAction
                  actionLabel={rec.actionLabel}
                  canAct={canAct}
                  onOpen={() => {
                    setCorrectionRow(row);
                    setDrawerOpen(true);
                  }}
                />
              </div>
            );
          })}
        </div>
      </ResponsiveTableShell>

      <PartAliasCorrectionDrawer open={drawerOpen} row={correctionRow} onClose={() => setDrawerOpen(false)} onApplied={refetch} />
    </div>
  );
}
