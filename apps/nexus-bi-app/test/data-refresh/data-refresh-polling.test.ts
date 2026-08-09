// NEXUS V3 - lógica de decisión del polling de DataRefreshControl.tsx
// (lib/data-refresh-polling.ts), probada como funciones puras porque el
// repo no tiene infraestructura de test de componentes (sin jsdom/RTL - ver
// el comentario de cabecera de ese archivo). Cubre los escenarios
// obligatorios de la sección 6 del encargo que SON expresables como lógica
// pura y parametrizada en el tiempo: sin corrida activa, QUEUED, QUEUED
// atascado, SUCCEEDED (detiene + notifica una sola vez), FAILED/PARTIAL_FAILED.
// Los escenarios que dependen del ciclo de vida real de React (remount/
// Strict Mode sin duplicar loops, "/login" sin llamadas) se cubren en
// test/data-refresh/data-refresh-control-structure.test.ts (chequeo
// estructural de fuente, mismo mecanismo que
// test/layout/root-layout-catch-isolation.test.ts) y se documentan en el
// reporte final como el límite real de lo verificable sin esa infraestructura.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_STATUSES,
  POLL_CEILING_MS,
  QUEUED_WARNING_MS,
  QUEUED_STUCK_MS,
  queuedFeedback,
  isPastCeiling,
  shouldContinuePolling,
  shouldNotifySucceeded
} from "../../lib/data-refresh-polling.ts";
import type { DataRefreshRunSummary, DataRefreshStatus } from "../../types/data-refresh.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function makeRun(overrides: Partial<DataRefreshRunSummary> = {}): DataRefreshRunSummary {
  return {
    refreshRunId: "11111111-1111-1111-1111-111111111111",
    environment: "LOCAL",
    mode: "INCREMENTAL",
    executorType: "LOCAL",
    status: "QUEUED",
    requestedByRole: "gerencia",
    requestedAt: new Date(NOW).toISOString(),
    startedAt: null,
    finishedAt: null,
    lastHeartbeatAt: null,
    currentStage: null,
    errorCode: null,
    errorSummary: null,
    validationStatus: null,
    ...overrides
  };
}

// --- Escenario 1: sin corrida activa -> el loop no debe seguir. ---------
describe("shouldContinuePolling: sin corrida activa", () => {
  test("run=null -> false (una sola consulta, cero polling posterior)", () => {
    assert.equal(shouldContinuePolling(null, NOW), false);
  });
});

// --- Escenario 2: QUEUED -> polling activo. ------------------------------
describe("shouldContinuePolling: QUEUED/CLAIMED/RUNNING", () => {
  for (const status of ["QUEUED", "CLAIMED", "RUNNING"] as DataRefreshStatus[]) {
    test(`status=${status} recién solicitado -> true`, () => {
      assert.equal(shouldContinuePolling(makeRun({ status, requestedAt: new Date(NOW).toISOString() }), NOW), true);
    });
  }

  test("ACTIVE_STATUSES contiene exactamente QUEUED/CLAIMED/RUNNING", () => {
    assert.deepEqual([...ACTIVE_STATUSES].sort(), ["CLAIMED", "QUEUED", "RUNNING"]);
  });
});

// --- Escenario 5: FAILED/PARTIAL_FAILED (y el resto de estados terminales) //
//     -> debe detener el polling. ----------------------------------------
describe("shouldContinuePolling: estados terminales", () => {
  for (const status of ["SUCCEEDED", "FAILED", "PARTIAL_FAILED", "CANCELLED", "SUPERSEDED"] as DataRefreshStatus[]) {
    test(`status=${status} -> false`, () => {
      assert.equal(shouldContinuePolling(makeRun({ status }), NOW), false);
    });
  }
});

// --- Techo duro de 30 minutos (independiente del estado). -----------------
describe("shouldContinuePolling / isPastCeiling: techo de 30 minutos", () => {
  test("exactamente 30 min -> todavía no superó el techo (comparación estricta '>')", () => {
    const run = makeRun({ status: "RUNNING", requestedAt: new Date(NOW - POLL_CEILING_MS).toISOString() });
    assert.equal(isPastCeiling(run, NOW), false);
    assert.equal(shouldContinuePolling(run, NOW), true);
  });

  test("30 min + 1ms -> superó el techo, detiene el polling aunque el estado siga activo", () => {
    const run = makeRun({ status: "RUNNING", requestedAt: new Date(NOW - POLL_CEILING_MS - 1).toISOString() });
    assert.equal(isPastCeiling(run, NOW), true);
    assert.equal(shouldContinuePolling(run, NOW), false);
  });
});

// --- Escenario 3: QUEUED atascado -> mensajes en los umbrales exactos. ----
describe("queuedFeedback: umbrales exactos de la sección 3 del encargo", () => {
  test("< 15s -> 'Actualización en cola…'", () => {
    const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW - 5_000).toISOString() });
    assert.equal(queuedFeedback(run, NOW), "Actualización en cola…");
  });

  test("exactamente 15s -> todavía 'en cola' (comparación estricta '>', no '>=')", () => {
    const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW - QUEUED_WARNING_MS).toISOString() });
    assert.equal(queuedFeedback(run, NOW), "Actualización en cola…");
  });

  test("15s + 1ms -> 'Actualización en cola. Verifica que el worker local esté activo.'", () => {
    const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW - QUEUED_WARNING_MS - 1).toISOString() });
    assert.equal(queuedFeedback(run, NOW), "Actualización en cola. Verifica que el worker local esté activo.");
  });

  test("exactamente 2min -> todavía advertencia, no 'atascada'", () => {
    const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW - QUEUED_STUCK_MS).toISOString() });
    assert.equal(queuedFeedback(run, NOW), "Actualización en cola. Verifica que el worker local esté activo.");
  });

  test("2min + 1ms -> 'Actualización atascada: ningún worker ha reclamado la corrida.'", () => {
    const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW - QUEUED_STUCK_MS - 1).toISOString() });
    assert.equal(queuedFeedback(run, NOW), "Actualización atascada: ningún worker ha reclamado la corrida.");
  });

  test("nunca marca la corrida FAILED por sí solo - es solo un string, no una mutación de estado", () => {
    const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW - QUEUED_STUCK_MS - 1).toISOString() });
    queuedFeedback(run, NOW);
    assert.equal(run.status, "QUEUED", "queuedFeedback nunca debe mutar la corrida ni implicar un cambio de status");
  });

  test("estado no-QUEUED (ej. RUNNING atascado) -> null, el mensaje de 'en cola' es específico de QUEUED", () => {
    const run = makeRun({ status: "RUNNING", requestedAt: new Date(NOW - QUEUED_STUCK_MS - 1).toISOString() });
    assert.equal(queuedFeedback(run, NOW), null);
  });

  // Cumple literalmente "pruebas con fake timers" (sección 6) usando
  // mock.timers de node:test sobre Date, en vez de pasar nowMs explícito -
  // ambos estilos ejercitan el mismo código; este además prueba que el
  // parámetro por defecto (nowMs = Date.now()) funciona de verdad.
  test("con mock.timers: Date.now() avanzando de 'en cola' a 'atascada' sin pasar nowMs explícito", () => {
    mock.timers.enable({ apis: ["Date"], now: NOW });
    try {
      const run = makeRun({ status: "QUEUED", requestedAt: new Date(NOW).toISOString() });
      assert.equal(queuedFeedback(run), "Actualización en cola…");

      mock.timers.tick(QUEUED_WARNING_MS + 1);
      assert.equal(queuedFeedback(run), "Actualización en cola. Verifica que el worker local esté activo.");

      mock.timers.tick(QUEUED_STUCK_MS - QUEUED_WARNING_MS);
      assert.equal(queuedFeedback(run), "Actualización atascada: ningún worker ha reclamado la corrida.");
    } finally {
      mock.timers.reset();
    }
  });
});

// --- Escenario 4: SUCCEEDED -> detiene el polling + notifica una sola vez. //
describe("shouldNotifySucceeded: exactamente una vez por refresh_run_id", () => {
  test("primera vez que se ve un run SUCCEEDED (lastNotifiedRunId=null) -> true", () => {
    const run = makeRun({ status: "SUCCEEDED", finishedAt: new Date(NOW).toISOString() });
    assert.equal(shouldNotifySucceeded(run, null), true);
  });

  test("mismo run, ya notificado -> false (nunca dos veces para el mismo id)", () => {
    const run = makeRun({ status: "SUCCEEDED", finishedAt: new Date(NOW).toISOString() });
    assert.equal(shouldNotifySucceeded(run, run.refreshRunId), false);
  });

  test("un run SUCCEEDED distinto (id distinto) -> true, aunque ya se haya notificado otro antes", () => {
    const previouslyNotifiedId = "22222222-2222-2222-2222-222222222222";
    const run = makeRun({ refreshRunId: "33333333-3333-3333-3333-333333333333", status: "SUCCEEDED" });
    assert.equal(shouldNotifySucceeded(run, previouslyNotifiedId), true);
  });

  test("run no-SUCCEEDED -> false sin importar lastNotifiedRunId", () => {
    for (const status of ["QUEUED", "CLAIMED", "RUNNING", "FAILED", "PARTIAL_FAILED", "CANCELLED", "SUPERSEDED"] as DataRefreshStatus[]) {
      assert.equal(shouldNotifySucceeded(makeRun({ status }), null), false, `status=${status}`);
    }
  });

  test("simulación de polling completo: RUNNING (no notifica) -> SUCCEEDED (notifica una vez) -> mismo fetch repetido (no vuelve a notificar)", () => {
    let lastNotifiedRunId: string | null = null;
    let notifications = 0;

    function onTick(run: DataRefreshRunSummary) {
      if (shouldNotifySucceeded(run, lastNotifiedRunId)) {
        lastNotifiedRunId = run.refreshRunId;
        notifications += 1;
      }
    }

    const runId = "44444444-4444-4444-4444-444444444444";
    onTick(makeRun({ refreshRunId: runId, status: "QUEUED" }));
    onTick(makeRun({ refreshRunId: runId, status: "RUNNING" }));
    onTick(makeRun({ refreshRunId: runId, status: "SUCCEEDED", finishedAt: new Date(NOW).toISOString() }));
    // El polling ya se detuvo tras SUCCEEDED (shouldContinuePolling=false),
    // pero si algo disparara otra consulta manual del mismo run (ej. un
    // remount), nunca debe volver a emitir para ESTE MISMO id.
    onTick(makeRun({ refreshRunId: runId, status: "SUCCEEDED", finishedAt: new Date(NOW).toISOString() }));

    assert.equal(notifications, 1);
  });
});
