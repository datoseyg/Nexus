import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldApplyResponse } from "../../lib/use-after-hours-section.ts";

// El hook completo (useEffect/useState) no es testeable sin jsdom (el repo
// no tiene esa infraestructura para ningún componente hoy - ver
// test/after-hours/*.test.ts, todos lógica pura o integración real contra
// Postgres). Se extrajo la única pieza que decide si una respuesta fuera
// de orden se aplica o se descarta, para poder probar exactamente el
// escenario pedido sin DOM: petición A, cambio de filtro (dispara B),
// responde B primero, responde A después -el estado final debe reflejar B.

test("shouldApplyResponse: una respuesta cuyo requestId coincide con el vigente se aplica", () => {
  assert.equal(shouldApplyResponse(1, 1), true);
});

test("shouldApplyResponse: secuencia real - A(id=1) se dispara, cambia el filtro (dispara B, id=2) - cuando A resuelve DESPUÉS, su id ya no coincide con el vigente (2) y se descarta", () => {
  const requestIdAtA = 1;
  const currentAfterFilterChange = 2; // el efecto ya incrementó el contador al disparar B
  assert.equal(shouldApplyResponse(requestIdAtA, currentAfterFilterChange), false, "A debe descartarse, sin importar si resuelve antes o después que B");
});

test("shouldApplyResponse: B (la petición vigente) siempre se aplica, resuelva antes o después que A", () => {
  const requestIdAtB = 2;
  const current = 2;
  assert.equal(shouldApplyResponse(requestIdAtB, current), true);
});

test("shouldApplyResponse: reintento manual (retry) que no cambia filtros sigue siendo el requestId vigente", () => {
  // retry() dispara una re-ejecución del mismo efecto (vía retryNonce),
  // incrementando requestIdRef igual que un cambio de filtro - su propia
  // respuesta sí debe aplicarse.
  assert.equal(shouldApplyResponse(3, 3), true);
});
