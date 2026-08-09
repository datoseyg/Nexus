// Lógica de decisión del polling de components/data-refresh/DataRefreshControl.tsx,
// extraída a un módulo .ts (sin JSX) a propósito: el repo no tiene
// infraestructura de test de componentes (sin jsdom/@testing-library, ver
// test/ts-extension-loader.mjs - solo resuelve specifiers, nunca transforma
// JSX; y --experimental-strip-types de Node solo admite sintaxis TS
// "erasable", JSX no lo es). Un .tsx con JSX real no puede importarse desde
// node:test en este repo (mismo límite documentado en
// test/layout/root-layout-catch-isolation.test.ts). Estas funciones son
// puras y parametrizadas en el tiempo (nunca Date.now() implícito) para que
// test/data-refresh/data-refresh-polling.test.ts pueda ejercitarlas de
// verdad, con mock.timers de node:test, en vez de solo confiar en que los
// umbrales son correctos.
import type { DataRefreshRunSummary, DataRefreshStatus } from "@/types/data-refresh";

export const ACTIVE_STATUSES = new Set<DataRefreshStatus>(["QUEUED", "CLAIMED", "RUNNING"]);

export const POLL_CEILING_MS = 30 * 60 * 1000;
export const QUEUED_WARNING_MS = 15 * 1000;
export const QUEUED_STUCK_MS = 2 * 60 * 1000;

// Requisito 3 (NEXUS V3) - una corrida QUEUED sin worker activo nunca se
// marca FAILED desde acá (eso exige evidencia real - heartbeat vencido -,
// ver pipeline.fn_reap_stale_refresh_runs, sql/102). Esto es SOLO un mensaje.
export function queuedFeedback(run: DataRefreshRunSummary, nowMs: number = Date.now()): string | null {
  if (run.status !== "QUEUED") return null;
  const queuedForMs = nowMs - new Date(run.requestedAt).getTime();
  if (queuedForMs > QUEUED_STUCK_MS) return "Actualización atascada: ningún worker ha reclamado la corrida.";
  if (queuedForMs > QUEUED_WARNING_MS) return "Actualización en cola. Verifica que el worker local esté activo.";
  return "Actualización en cola…";
}

export function isPastCeiling(run: DataRefreshRunSummary, nowMs: number = Date.now()): boolean {
  return nowMs - new Date(run.requestedAt).getTime() > POLL_CEILING_MS;
}

// Única fuente de verdad de "¿el loop de polling debe seguir?". Cubre a la
// vez: sin corrida -> false, estado terminal -> false, techo de 30 min
// superado -> false.
export function shouldContinuePolling(run: DataRefreshRunSummary | null, nowMs: number = Date.now()): boolean {
  if (!run) return false;
  if (!ACTIVE_STATUSES.has(run.status)) return false;
  return !isPastCeiling(run, nowMs);
}

// Requisito 4 - el evento de invalidación se emite EXACTAMENTE una vez por
// refresh_run_id que transiciona a SUCCEEDED, nunca una vez por fetch que
// simplemente vuelve a observar el mismo run ya notificado.
export function shouldNotifySucceeded(run: DataRefreshRunSummary, lastNotifiedRunId: string | null): boolean {
  return run.status === "SUCCEEDED" && run.refreshRunId !== lastNotifiedRunId;
}
