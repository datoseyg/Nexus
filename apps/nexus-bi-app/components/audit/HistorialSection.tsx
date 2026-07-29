"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { RestrictedReadReveal } from "./RestrictedReadReveal";
import { eventTypeLabel, commandTypeLabel } from "@/lib/audit-vocabulary";

interface HistorialSectionProps {
  role: "gerencia" | "administracion";
}

interface HistoryRow {
  id: string;
  correlation_id: string;
  event_type: string;
  issue_id: string | null;
  review_case_id: string | null;
  command_type: string | null;
  actor_role: string | null;
  reason: string | null;
  evidence_id: string | null;
  created_at: string;
}

interface HistoryResponse {
  rows: HistoryRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

const ROLE_LABELS: Record<string, string> = {
  gerencia: "Gerencia",
  administracion: "Administración"
};

// Color del punto de la línea de tiempo por categoría de evento - heurística
// sobre el prefijo del nombre (governance.event_types no expone su columna
// `category` a este endpoint todavía), nunca un canal de información único
// (el nombre de negocio siempre va como texto al lado, WCAG 1.4.1).
function eventDotColor(eventType: string): string {
  if (eventType === "CORRECTION_APPLIED" || eventType === "VERIFICATION_PASSED" || eventType === "ISSUE_RESOLVED_VERIFIED") return "var(--nx-success-fg)";
  if (
    eventType === "VERIFICATION_STILL_DETECTED" ||
    eventType === "VERIFICATION_OPERATIONAL_ERROR" ||
    eventType === "VERIFICATION_DEAD_LETTERED" ||
    eventType === "ISSUE_DISMISSED" ||
    eventType === "CORRECTION_REVERSED"
  ) {
    return "var(--nx-danger-fg)";
  }
  if (eventType === "ISSUE_DETECTED" || eventType === "ISSUE_REAPPEARED" || eventType === "ISSUE_ASSIGNED" || eventType === "ISSUE_REOPENED") {
    return "var(--nx-warning-border)";
  }
  if (eventType.startsWith("RESTRICTED_") || eventType.startsWith("REDACTED_") || eventType === "EXPORT_COMPLETED") return "var(--nx-text-muted)";
  return "var(--nx-accent-indigo)";
}

// Gate B - Familia 4/8: pestaña "Historial" - eventos confirmados
// (governance.command_events_business_safe, B54) en línea de tiempo (nunca
// una tabla ancha de 8 columnas - ilegible en mobile y no transmite
// secuencia). Solo transacciones que realmente se confirmaron (B59) - nunca
// antes/después crudo ni actor completo por defecto. Familia 6:
// Administración puede revelar el before/after restringido de un evento
// (fn_read_restricted_event_state) y, cuando el evento referencia
// evidencia, también la evidencia restringida (fn_read_restricted_evidence)
// - ambas con razón obligatoria y auditadas.
export function HistorialSection({ role }: HistorialSectionProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/audit/history?page=${page}&pageSize=30`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <ResponsiveTableShell
      title="Historial de eventos"
      count={data?.totalRows}
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.rows.length ?? 0) === 0}
      emptyMessage="Sin eventos registrados."
      maxHeight={620}
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
      <ol className="flex flex-col">
        {data?.rows.map((row, idx) => (
          <li key={row.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
            {idx < data.rows.length - 1 && (
              <span className="absolute left-[7px] top-4 h-full w-px" style={{ background: "var(--nx-border)" }} aria-hidden="true" />
            )}
            <span
              className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2"
              style={{ background: eventDotColor(row.event_type), borderColor: "var(--nx-card-bg)" }}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {eventTypeLabel(row.event_type)}
                </span>
                <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {new Date(row.created_at).toLocaleString("es-CL")}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {row.command_type && <span>{commandTypeLabel(row.command_type)}</span>}
                {row.issue_id && <span>Incidencia #{row.issue_id}</span>}
                {row.review_case_id && <span>Caso #{row.review_case_id}</span>}
                {row.actor_role && <span>{ROLE_LABELS[row.actor_role] ?? row.actor_role}</span>}
              </div>
              {row.reason && (
                <p className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.reason}
                </p>
              )}
              {role === "administracion" && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <RestrictedReadReveal kind="event-state" objectId={Number(row.id)} label="Ver estado restringido" />
                  {row.evidence_id && <RestrictedReadReveal kind="evidence" objectId={Number(row.evidence_id)} label="Ver evidencia restringida" />}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </ResponsiveTableShell>
  );
}
