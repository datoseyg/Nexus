"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasCapability } from "@/lib/auth/capabilities-shared";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { dispatchDataRefreshSucceeded } from "@/lib/data-refresh-events";
import { ACTIVE_STATUSES, queuedFeedback, shouldContinuePolling, shouldNotifySucceeded } from "@/lib/data-refresh-polling";
import type { DataRefreshMode, DataRefreshRunDetail, DataRefreshRunSummary, DataRefreshStatus } from "@/types/data-refresh";

// Mecanismo de actualización manual de datos (requisitos 1/2/3.5 NEXUS V3) -
// montado UNA sola vez en components/layout/Sidebar.tsx, nunca duplicado
// por página. Este control solo encola/observa el entorno LOCAL: STAGING y
// PRODUCTION no tienen todavía un proyecto Supabase V3 real (ver reporte
// final) y su disparo es exclusivamente manual vía GitHub Actions
// (workflow_dispatch, docs/data-refresh-runbook.md) - exponer un selector
// de entorno acá crearía una corrida QUEUED que nadie procesaría.
const ENVIRONMENT = "LOCAL";
const POLL_INTERVAL_MS = 3000;

// Etiquetas legibles por etapa (requisito 5) - mismo orden real que
// scripts/pipeline/run-data-refresh.mjs::STAGES. Un valor no mapeado (etapa
// nueva agregada al orquestador sin actualizar acá) cae al propio nombre
// crudo en vez de desaparecer u ocultar el progreso.
const STAGE_LABELS: Record<string, string> = {
  EXTRACT: "Extrayendo fuentes",
  NORMALIZE: "Normalizando datos",
  BUILD_MARTS: "Construyendo cruces",
  BUILD_GOLD: "Construyendo métricas",
  SYNC_POSTGRES: "Sincronizando PostgreSQL",
  BUILD_WORKING_HOURS: "Calculando After-Hours",
  VALIDATE_AFTER_HOURS: "Validando calendarios y cobertura",
  VALIDATE: "Validando publicación",
  REEVALUATE_RULES: "Reevaluando Cerberus",
  PUBLISH_SNAPSHOT: "Publicando actualización"
};

function stageLabel(stage: string | null): string | null {
  if (!stage) return null;
  return STAGE_LABELS[stage] ?? stage;
}

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

function formatClock(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function fetchRunsList(): Promise<DataRefreshRunSummary[]> {
  const res = await fetch(`/api/data-refresh/runs?environment=${ENVIRONMENT}&limit=5`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/data-refresh/runs -> ${res.status}`);
  const body = await res.json();
  return body.runs ?? [];
}

async function fetchRunDetail(refreshRunId: string): Promise<DataRefreshRunDetail | null> {
  const res = await fetch(`/api/data-refresh/runs/${refreshRunId}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
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
  const [runDetail, setRunDetail] = useState<DataRefreshRunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  // Requisito 2.7 - único disparador de "reiniciar el polling ya", nunca
  // atado a que `latestRun` cambie de referencia (requisito 2.8): un POST
  // exitoso bumpea esto, la única dependencia "real" del efecto de abajo
  // además de canObserve.
  const [pollGeneration, setPollGeneration] = useState(0);

  // Nunca se resetea con un remount (requisito 2.9): el evento de
  // invalidación se dispara "una sola vez por refresh_run_id", no "una sola
  // vez por vida del componente" - si el componente remonta después de ya
  // haber notificado un ID, notificar nada distinto de nuevo para ESE MISMO
  // id no puede volver a pasar porque el fetch inicial siempre trae el
  // estado real (SUCCEEDED) y este ref, aunque reinicie a null, no vuelve a
  // emitir para un id que ya viejo entra como "distinto" de null - la única
  // consecuencia de un remount es como mucho 1 notificación extra para el
  // run que ya estaba SUCCEEDED al montar, nunca un loop ni una pérdida.
  const lastNotifiedRunIdRef = useRef<string | null>(null);

  const fetchLatestRun = useCallback(async (): Promise<DataRefreshRunSummary | null> => {
    let run: DataRefreshRunSummary | null;
    try {
      const runs = await fetchRunsList();
      run = runs[0] ?? null;
    } catch {
      return null; // best-effort - el badge simplemente no se actualiza esta vez
    }

    setLatestRun(run);

    if (run && shouldNotifySucceeded(run, lastNotifiedRunIdRef.current)) {
      lastNotifiedRunIdRef.current = run.refreshRunId;
      dispatchDataRefreshSucceeded({
        refreshRunId: run.refreshRunId,
        finishedAt: run.finishedAt ?? new Date().toISOString(),
        sourceSnapshotId: null
      });
    }

    if (run && ACTIVE_STATUSES.has(run.status)) {
      const detail = await fetchRunDetail(run.refreshRunId);
      setRunDetail(detail);
    } else {
      setRunDetail(null);
    }

    return run;
  }, []);

  // Requisito 2 - loop único, recursivo (setTimeout, no setInterval - nunca
  // superpone un tick con el fetch anterior todavía en vuelo). Dependencias
  // ESTABLES a propósito (canObserve es un booleano, fetchLatestRun está
  // memoizado con deps=[], pollGeneration solo cambia por una acción
  // explícita) - nunca depende de `latestRun` (requisito 2.8), así que un
  // fetch exitoso NUNCA reinicia este efecto ni duplica el timer.
  useEffect(() => {
    if (!canObserve) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollLoop() {
      const run = await fetchLatestRun();
      // Requisito 2.5 - React Strict Mode monta/desmonta/remonta en dev; la
      // primera invocación queda "cancelled" antes de que su fetch
      // resuelva, así nunca programa un timer duplicado con la segunda.
      if (cancelled) return;
      if (shouldContinuePolling(run)) {
        timer = setTimeout(pollLoop, POLL_INTERVAL_MS);
      }
      // Si no hay corrida, o quedó en estado terminal, o superó el techo de
      // 30 min: no se agenda nada más - el loop se detiene solo.
    }

    pollLoop(); // consulta inicial al montar (requisito 2.1), sin esperar el primer tick

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canObserve, fetchLatestRun, pollGeneration]);

  if (!canObserve) return null;

  async function handleIncremental() {
    setBusy(true);
    setError(null);
    const result = await startRun({ mode: "INCREMENTAL", confirmed: false, reason: null });
    setBusy(false);
    if (result.error) setError(result.error);
    else setPollGeneration(g => g + 1);
  }

  async function handleFullConfirmed() {
    setBusy(true);
    setError(null);
    const result = await startRun({ mode: "FULL", confirmed: true, reason: "Actualización completa solicitada manualmente desde la UI." });
    setBusy(false);
    setConfirmOpen(false);
    setConfirmChecked(false);
    if (result.error) setError(result.error);
    else setPollGeneration(g => g + 1);
  }

  const isActive = latestRun ? ACTIVE_STATUSES.has(latestRun.status) : false;
  const badge = latestRun ? STATUS_BADGE[latestRun.status] : null;
  const tooltip = latestRun ? `${badge?.label ?? latestRun.status} · ${formatRelative(latestRun.finishedAt ?? latestRun.requestedAt)}` : "Sin corridas registradas";
  const queuedMessage = latestRun ? queuedFeedback(latestRun) : null;
  const progressLabel = runDetail ? stageLabel(runDetail.currentStage) : null;

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

      {/* Requisito 5 - progreso real, nunca solo "Actualización en curso".
          current_stage/hora de inicio/último heartbeat, del detalle real. */}
      {!compact && isActive ? (
        <div className="px-2.5 text-[10px] leading-snug" style={{ color: "var(--nx-sidebar-text-secondary)" }} role="status" aria-live="polite">
          {queuedMessage ? <p>{queuedMessage}</p> : null}
          {progressLabel ? <p>{progressLabel}</p> : null}
          {runDetail?.startedAt ? <p>Inicio: {formatClock(runDetail.startedAt)}</p> : null}
          {runDetail?.lastHeartbeatAt ? <p>Último latido: {formatClock(runDetail.lastHeartbeatAt)}</p> : null}
        </div>
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
