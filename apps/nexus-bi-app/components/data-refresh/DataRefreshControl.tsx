"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasCapability } from "@/lib/auth/capabilities-shared";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import type { DataRefreshMode, DataRefreshRunSummary, DataRefreshStatus } from "@/types/data-refresh";

// Mecanismo de actualización manual de datos (requisitos 1/2/3.5 NEXUS V3) -
// montado UNA sola vez en components/layout/Sidebar.tsx, nunca duplicado
// por página. Este control solo encola/observa el entorno LOCAL: STAGING y
// PRODUCTION no tienen todavía un proyecto Supabase V3 real (ver reporte
// final) y su disparo es exclusivamente manual vía GitHub Actions
// (workflow_dispatch, docs/data-refresh-runbook.md) - exponer un selector
// de entorno acá crearía una corrida QUEUED que nadie procesaría.
const ENVIRONMENT = "LOCAL";
const ACTIVE_STATUSES = new Set(["QUEUED", "CLAIMED", "RUNNING"]);
const POLL_INTERVAL_MS = 3000;
const POLL_CEILING_MS = 30 * 60 * 1000;

// Mapeo local hacia el contrato ya existente de StatusBadge (label+tone) -
// mismo criterio que components/home/HomeDataStatus.tsx::STATUS_BADGE, nunca
// un sistema de colores/etiquetas paralelo. DOT_COLOR_BY_TONE es aparte
// porque el indicador compacto (sidebar colapsada, fondo oscuro) no puede
// reusar los colores claros de StatusBadge (pensados para fondo blanco).
const STATUS_BADGE: Record<DataRefreshStatus, { label: string; tone: StatusTone }> = {
  QUEUED: { label: "En cola", tone: "info" },
  CLAIMED: { label: "Reclamada", tone: "info" },
  RUNNING: { label: "En curso", tone: "info" },
  SUCCEEDED: { label: "Actualizado", tone: "success" },
  FAILED: { label: "Falló", tone: "danger" },
  PARTIAL_FAILED: { label: "Falló (parcial)", tone: "danger" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
  SUPERSEDED: { label: "Reemplazada", tone: "neutral" }
};

const DOT_COLOR_BY_TONE: Record<StatusTone, string> = {
  success: "var(--nx-accent-emerald, #2f9e6e)",
  danger: "#e0645f",
  info: "var(--nx-accent-indigo)",
  warning: "#e0a53f",
  neutral: "var(--nx-sidebar-text-secondary)"
};

function formatRelative(iso: string | null): string {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "hace instantes";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  return new Date(iso).toLocaleDateString("es-CL");
}

async function fetchRuns(): Promise<DataRefreshRunSummary[]> {
  const res = await fetch(`/api/data-refresh/runs?environment=${ENVIRONMENT}&limit=5`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/data-refresh/runs -> ${res.status}`);
  const body = await res.json();
  return body.runs ?? [];
}

interface StartRunOptions {
  mode: DataRefreshMode;
  confirmed: boolean;
  reason: string | null;
}

async function startRun(options: StartRunOptions): Promise<{ status: string; error?: string }> {
  const res = await fetch("/api/data-refresh/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ environment: ENVIRONMENT, mode: options.mode, executorType: "LOCAL", confirmed: options.confirmed, reason: options.reason })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { status: "ERROR", error: body?.error ?? `HTTP ${res.status}` };
  return { status: body.status };
}

export function DataRefreshControl({ capabilities, compact }: { capabilities: string[]; compact: boolean }) {
  const canObserve = hasCapability(capabilities, "data:refresh:observe");
  const canIncremental = hasCapability(capabilities, "data:refresh:incremental");
  const canFull = hasCapability(capabilities, "data:refresh:full");

  const [latestRun, setLatestRun] = useState<DataRefreshRunSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const pollStartedAtRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const runs = await fetchRuns();
      setLatestRun(runs[0] ?? null);
    } catch {
      /* best-effort - el badge simplemente no se actualiza esta vez */
    }
  }, []);

  useEffect(() => {
    if (!canObserve) return;
    refresh();
  }, [canObserve, refresh]);

  useEffect(() => {
    if (!canObserve || !latestRun || !ACTIVE_STATUSES.has(latestRun.status)) {
      pollStartedAtRef.current = null;
      return;
    }
    if (pollStartedAtRef.current === null) pollStartedAtRef.current = Date.now();

    const interval = setInterval(() => {
      if (Date.now() - (pollStartedAtRef.current ?? Date.now()) > POLL_CEILING_MS) {
        clearInterval(interval);
        return;
      }
      refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [canObserve, latestRun, refresh]);

  if (!canObserve) return null;

  async function handleIncremental() {
    setBusy(true);
    setError(null);
    const result = await startRun({ mode: "INCREMENTAL", confirmed: false, reason: null });
    setBusy(false);
    if (result.error) setError(result.error);
    else refresh();
  }

  async function handleFullConfirmed() {
    setBusy(true);
    setError(null);
    const result = await startRun({ mode: "FULL", confirmed: true, reason: "Actualización completa solicitada manualmente desde la UI." });
    setBusy(false);
    setConfirmOpen(false);
    setConfirmChecked(false);
    if (result.error) setError(result.error);
    else refresh();
  }

  const isActive = latestRun ? ACTIVE_STATUSES.has(latestRun.status) : false;
  const badge = latestRun ? STATUS_BADGE[latestRun.status] : null;
  const tooltip = latestRun ? `${badge?.label ?? latestRun.status} · ${formatRelative(latestRun.finishedAt ?? latestRun.requestedAt)}` : "Sin corridas registradas";

  return (
    <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
      <div className={`flex items-center gap-2 px-2.5 ${compact ? "justify-center" : ""}`} title={tooltip}>
        {compact ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: badge ? DOT_COLOR_BY_TONE[badge.tone] : DOT_COLOR_BY_TONE.neutral, boxShadow: isActive ? "0 0 0 3px rgba(255,255,255,0.12)" : undefined }}
            aria-hidden="true"
          />
        ) : (
          <>
            <span className="text-[11px] font-semibold" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
              Datos:
            </span>
            {badge ? <StatusBadge label={badge.label} tone={badge.tone} size="sm" /> : <StatusBadge label="Sin corridas" tone="neutral" size="sm" />}
          </>
        )}
        <span className="sr-only">{tooltip}</span>
      </div>
      {!compact && latestRun && !isActive ? (
        <span className="px-2.5 text-[10px]" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
          {formatRelative(latestRun.finishedAt)}
        </span>
      ) : null}

      {canIncremental ? (
        <button
          type="button"
          onClick={handleIncremental}
          disabled={busy || isActive}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--nx-radius-button)] px-2.5 py-2 text-[12px] font-semibold disabled:opacity-50"
          style={{ color: "var(--nx-sidebar-text-secondary)", background: "rgba(255,255,255,0.06)" }}
        >
          <span className={compact ? "sr-only" : undefined}>{isActive ? "Actualización en curso…" : "Actualizar ahora"}</span>
          <span className={compact ? undefined : "sr-only"}>↻</span>
        </button>
      ) : null}

      {canFull ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || isActive}
          className={compact ? "sr-only" : "text-[10px] font-medium underline disabled:opacity-50"}
          style={{ color: "var(--nx-sidebar-text-secondary)" }}
        >
          Actualización completa (FULL)…
        </button>
      ) : null}

      {error ? (
        <p className={compact ? "sr-only" : "px-2.5 text-[11px]"} style={{ color: "#fca5a5" }} role="alert">
          {error}
        </p>
      ) : null}

      {confirmOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Confirmar actualización completa" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-[var(--nx-radius-card)] bg-white p-5 text-[13px] text-[var(--nx-text-primary,#1a1a1a)]">
            <h2 className="mb-2 text-[14px] font-bold">Actualización completa (FULL)</h2>
            <p className="mb-3">
              Esto re-extrae y reconstruye TODO el pipeline local (FieldBeat, Zendesk, Dolibarr) desde cero, en vez de solo lo
              incremental. Puede tardar varios minutos y usa más cuota de las APIs externas.
            </p>
            <label className="mb-4 flex items-start gap-2">
              <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} className="mt-0.5" />
              <span>Entiendo y quiero forzar una actualización completa.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmChecked(false);
                }}
                className="rounded-[var(--nx-radius-button)] px-3 py-1.5 font-semibold"
                style={{ background: "#eee" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleFullConfirmed}
                disabled={!confirmChecked || busy}
                className="rounded-[var(--nx-radius-button)] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--nx-accent-indigo)" }}
              >
                Confirmar FULL
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
