import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldApplyFieldbeatResponse } from "../../lib/use-fieldbeat-dashboard.ts";

// ETAPA 5 - useFieldbeatDashboard() en sí (useEffect/useState) no es
// testeable sin jsdom (convención ya establecida en el repo) - se extrae
// la lógica de "descartar respuesta obsoleta" a esta función pura,
// idéntico patrón a shouldApplyResponse() de after-hours
// (lib/use-after-hours-section.ts).

test("shouldApplyFieldbeatResponse: mismo requestId -> se aplica", () => {
  assert.equal(shouldApplyFieldbeatResponse(1, 1), true);
});

test("shouldApplyFieldbeatResponse: requestId distinto -> se descarta", () => {
  assert.equal(shouldApplyFieldbeatResponse(1, 2), false);
});

test("shouldApplyFieldbeatResponse: escenario exacto - fetch inicial (id=1) en curso, retry() dispara id=2, id=2 resuelve primero, id=1 resuelve después -> el estado final refleja id=2, id=1 se descarta", () => {
  let currentRequestId = 1; // fetch inicial dispara id=1

  currentRequestId = 2; // retry() incrementa antes de que el fetch inicial resuelva

  // Resuelve primero id=2 (la más nueva) - se aplica.
  assert.equal(shouldApplyFieldbeatResponse(2, currentRequestId), true);

  // Resuelve después id=1 (obsoleta) - se descarta sin tocar el estado.
  assert.equal(shouldApplyFieldbeatResponse(1, currentRequestId), false);
});
