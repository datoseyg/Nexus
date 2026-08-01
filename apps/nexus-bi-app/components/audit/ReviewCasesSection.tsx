"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, reviewCaseStatusBadge } from "@/components/ui/StatusBadge";
import { ReviewCaseCreateDrawer } from "./ReviewCaseCreateDrawer";
import { ReviewCaseDetailDrawer } from "./ReviewCaseDetailDrawer";
import { triggerBlobDownload } from "@/lib/csv-export";
import { hasCapability } from "@/lib/auth/capabilities-shared";

interface ReviewCasesSectionProps {
  role: "gerencia" | "administracion";
  capabilities: string[];
}

const STATUS_OPTIONS = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"];

interface ReviewCaseRow {
  id: string;
  status: string;
  assigned_to: string | null;
  opened_at: string;
  closed_at: string | null;
  active_issue_count: string;
  comment_count: string;
}

interface ReviewCasesResponse {
  rows: ReviewCaseRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  statusCounts: Array<{ status: string; n: string }>;
}

function HeaderStat({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex flex-col gap-0.5 rounded-[var(--nx-radius-card)] px-3.5 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        background: "var(--nx-card-bg)",
        boxShadow: "var(--nx-shadow-card)",
        border: active ? "2px solid var(--nx-accent-indigo)" : "1px solid transparent",
        outlineColor: "var(--nx-focus-ring-color)"
      }}
    >
      <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </span>
      <span className="tabular-nums text-lg font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {value.toLocaleString("es-CL")}
      </span>
    </button>
  );
}

// Gate B - Familia 4/8: pestaña "Casos" - governance.review_cases. Gerencia
// ve el listado completo de solo lectura (audit:read); Administración además
// puede crear casos y abrir el detalle con acciones (audit:review/assign/
// comment/redact-comment, verificadas server-side por cada ruta).
export function ReviewCasesSection({ role, capabilities }: ReviewCasesSectionProps) {
  const canReview = hasCapability(capabilities, "audit:review");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReviewCasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/audit/review-cases/export?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExportError(body?.error ?? `No fue posible exportar (HTTP ${res.status}).`);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? "nexus-auditoria-casos.csv";
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
    } catch {
      setExportError("No fue posible exportar - revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  function refetch() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status) params.set("status", status);
    fetch(`/api/audit/review-cases?${params.toString()}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }

  useEffect(refetch, [status, page]);

  const statusCountMap = Object.fromEntries((data?.statusCounts ?? []).map(row => [row.status, Number(row.n)]));
  const totalCases = STATUS_OPTIONS.reduce((sum, option) => sum + (statusCountMap[option] ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <HeaderStat
          label="Todos los casos"
          value={totalCases}
          active={status === ""}
          onClick={() => {
            setStatus("");
            setPage(1);
          }}
        />
        {STATUS_OPTIONS.map(option => (
          <HeaderStat
            key={option}
            label={reviewCaseStatusBadge(option).label}
            value={statusCountMap[option] ?? 0}
            active={status === option}
            onClick={() => {
              setStatus(status === option ? "" : option);
              setPage(1);
            }}
          />
        ))}
      </div>

      <FilterBar
        actions={
          <>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
            >
              {exporting ? "Exportando…" : "Exportar CSV"}
            </button>
            {canReview && (
              <button
                type="button"
                onClick={() => {
                  // Nunca dos drawers abiertos a la vez (B22) - si el detalle
                  // de un caso ya estaba abierto, se cierra antes de abrir el
                  // de creación.
                  setSelectedCaseId(null);
                  setCreateOpen(true);
                }}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                style={{ background: "var(--nx-accent, #4a55d4)" }}
              >
                Nuevo caso
              </button>
            )}
          </>
        }
      >
        <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          {canReview ? "Selecciona un caso para ver su detalle." : "Vista de solo lectura."}
        </span>
      </FilterBar>

      {exportError && (
        <div role="alert" className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--nx-danger, #c0392b)", color: "var(--nx-danger, #c0392b)" }}>
          {exportError}
        </div>
      )}

      <ResponsiveTableShell
        title="Casos de revisión"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage={status ? "Sin casos para este filtro." : "Sin casos de revisión creados todavía."}
        maxHeight={480}
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
              <th className="text-left">Caso</th>
              <th className="text-left">Estado</th>
              <th className="text-left">Incidencias activas</th>
              <th className="text-left">Comentarios</th>
              <th className="text-left">Abierto</th>
              <th className="text-left">Cerrado</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => (
              <tr
                key={row.id}
                onClick={() => {
                  // Nunca dos drawers abiertos a la vez (B22).
                  setCreateOpen(false);
                  setSelectedCaseId(row.id);
                }}
                style={{ cursor: "pointer" }}
                tabIndex={0}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setCreateOpen(false);
                    setSelectedCaseId(row.id);
                  }
                }}
              >
                <td>#{row.id}</td>
                <td>
                  <StatusBadge {...reviewCaseStatusBadge(row.status)} size="sm" />
                </td>
                <td>{row.active_issue_count}</td>
                <td>{row.comment_count}</td>
                <td>{new Date(row.opened_at).toLocaleString("es-CL")}</td>
                <td>{row.closed_at ? new Date(row.closed_at).toLocaleString("es-CL") : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setCreateOpen(false);
                setSelectedCaseId(row.id);
              }}
              className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] border p-3 text-left"
              style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  Caso #{row.id}
                </span>
                <StatusBadge {...reviewCaseStatusBadge(row.status)} size="sm" />
              </div>
              <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {row.active_issue_count} incidencia{row.active_issue_count === "1" ? "" : "s"} activa{row.active_issue_count === "1" ? "" : "s"} · {row.comment_count} comentario{row.comment_count === "1" ? "" : "s"}
              </div>
              <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                Abierto: {new Date(row.opened_at).toLocaleString("es-CL")}
                {row.closed_at && ` · Cerrado: ${new Date(row.closed_at).toLocaleString("es-CL")}`}
              </div>
            </button>
          ))}
        </div>
      </ResponsiveTableShell>

      {canReview && (
        <ReviewCaseCreateDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}

      <ReviewCaseDetailDrawer reviewCaseId={selectedCaseId} role={role} capabilities={capabilities} onClose={() => setSelectedCaseId(null)} onChanged={refetch} />
    </div>
  );
}
