"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { evaluationRunStatusLabel, evaluationScopeModeLabel, evaluationTriggeredByLabel } from "@/lib/audit-vocabulary";
import { useDataRefreshEpoch } from "@/components/data-refresh/DataRefreshEpochProvider";

interface RunRow {
  evaluation_run_id: string;
  rule_set_version: string;
  scope_mode: string;
  scope_rule_code: string | null;
  scope_rule_title: string | null;
  status: string;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  rows_evaluated: number | null;
  issues_detected: number | null;
  issues_new: number | null;
  issues_persistent: number | null;
  issues_disappeared: number | null;
  error_message: string | null;
}

interface RunsResponse {
  rows: RunRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

function runStatusTone(status: string): StatusTone {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "RUNNING":
      return "info";
    case "PARTIAL_FAILED_NOT_PUBLISHED":
    case "FAILED":
      return "danger";
    case "SUPERSEDED_NOT_PUBLISHED":
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

function scopeLabel(row: RunRow): string {
  const base = evaluationScopeModeLabel(row.scope_mode);
  return row.scope_rule_title ? `${base}: ${row.scope_rule_title}` : base;
}

// Gate B - Familia 8: pestaña "Fuentes y pipeline" - estado del evaluador de
// reglas (governance.rule_evaluation_runs), solo lectura. El mecanismo real
// de actualización de datos desde FieldBeat/Zendesk/Dolibarr (NEXUS V3,
// pipeline.refresh_runs) vive en la sidebar (DataRefreshControl, junto a
// UserSessionControls) - no se duplica acá; el banner de abajo solo orienta
// hacia dónde está (honestidad de estado, docs/design-context/09 "estado
// del dato siempre visible").
export function FuentesPipelineSection() {
  const epoch = useDataRefreshEpoch();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/audit/evaluation-runs?page=${page}&pageSize=20`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [page, epoch]);

  const lastSucceeded = data?.rows.find(row => row.status === "SUCCEEDED");

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--nx-radius-card)] p-3.5 text-sm" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        {lastSucceeded ? (
          <span style={{ color: "var(--nx-text-primary)" }}>
            Última evaluación exitosa: {new Date(lastSucceeded.finished_at ?? lastSucceeded.started_at).toLocaleString("es-CL")}
          </span>
        ) : (
          <span style={{ color: "var(--nx-text-secondary)" }}>Sin corridas exitosas registradas todavía en esta página.</span>
        )}
      </div>

      <div className="rounded-[var(--nx-radius-card)] p-3.5 text-xs" style={{ background: "var(--nx-warning-bg)", border: "1px solid var(--nx-warning-border)", color: "var(--nx-warning-fg)" }}>
        Esta vista muestra las corridas del evaluador de reglas sobre los datos ya cargados - ningún botón de esta pantalla dispara una
        extracción nueva. Para solicitar una actualización manual de datos desde FieldBeat, Zendesk o Dolibarr, usá el control &quot;Datos&quot;
        en el menú lateral.
      </div>

      <ResponsiveTableShell
        title="Corridas del evaluador de reglas"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin corridas registradas."
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
              <th className="text-left">Inicio</th>
              <th className="text-left">Alcance</th>
              <th className="text-left">Disparada por</th>
              <th className="text-left">Estado</th>
              <th className="text-left">Detectadas</th>
              <th className="text-left">Nuevas</th>
              <th className="text-left">Persistentes</th>
              <th className="text-left">Desaparecidas</th>
              <th className="text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(row => (
              <tr key={row.evaluation_run_id}>
                <td>{new Date(row.started_at).toLocaleString("es-CL")}</td>
                <td>{scopeLabel(row)}</td>
                <td>{evaluationTriggeredByLabel(row.triggered_by)}</td>
                <td>
                  <StatusBadge label={evaluationRunStatusLabel(row.status)} tone={runStatusTone(row.status)} size="sm" />
                </td>
                <td>{row.issues_detected ?? "-"}</td>
                <td>{row.issues_new ?? "-"}</td>
                <td>{row.issues_persistent ?? "-"}</td>
                <td>{row.issues_disappeared ?? "-"}</td>
                <td title={row.error_message ?? ""}>{row.error_message ? "Sí" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col gap-2.5 md:hidden">
          {data?.rows.map(row => (
            <div key={row.evaluation_run_id} className="flex flex-col gap-1.5 rounded-[var(--nx-radius-card)] border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm" style={{ color: "var(--nx-text-primary)" }}>
                  {new Date(row.started_at).toLocaleString("es-CL")}
                </span>
                <StatusBadge label={evaluationRunStatusLabel(row.status)} tone={runStatusTone(row.status)} size="sm" />
              </div>
              <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {scopeLabel(row)} · {evaluationTriggeredByLabel(row.triggered_by)}
              </div>
              <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                Detectadas: {row.issues_detected ?? "-"} · Nuevas: {row.issues_new ?? "-"} · Persistentes: {row.issues_persistent ?? "-"} · Desaparecidas: {row.issues_disappeared ?? "-"}
              </div>
              {row.error_message && (
                <div className="text-xs" style={{ color: "var(--nx-danger-fg)" }}>
                  {row.error_message}
                </div>
              )}
            </div>
          ))}
        </div>
      </ResponsiveTableShell>
    </div>
  );
}
