import { test } from "node:test";
import assert from "node:assert/strict";
import { formatModelCell } from "../../lib/explorer-entity-config.ts";

// Sección 14.2 del encargo NEXUS V3 After-Hours - formatModelCell (extendida
// para exponer una rama UNKNOWN explícita, antes caía en formatValue() que
// devolvía "-") es reutilizada TAL CUAL por AfterHoursDetailTable.tsx, no
// reimplementada - estas pruebas cubren el contrato compartido por ambos
// consumidores (Explorador y After-Hours).
test("formatModelCell: RESOLVED muestra el modelo real", () => {
  assert.equal(formatModelCell("VersaHD", { model_resolution_status: "RESOLVED" }), "VersaHD");
});

test("formatModelCell: AMBIGUOUS siempre muestra 'Modelo por confirmar', nunca el valor crudo (aunque venga uno)", () => {
  assert.equal(formatModelCell(null, { model_resolution_status: "AMBIGUOUS" }), "Modelo por confirmar");
  assert.equal(formatModelCell("ValorQueNoDeberiaVerse", { model_resolution_status: "AMBIGUOUS" }), "Modelo por confirmar");
});

test("formatModelCell: UNKNOWN nunca muestra '-'/'N/A'/'NA'/null/'' - siempre '—' (guion largo)", () => {
  assert.equal(formatModelCell(null, { model_resolution_status: "UNKNOWN" }), "—");
  assert.equal(formatModelCell(undefined, { model_resolution_status: "UNKNOWN" }), "—");
  assert.equal(formatModelCell("", { model_resolution_status: "UNKNOWN" }), "—");
});

test("formatModelCell: valor null/undefined/'' sin model_resolution_status reconocible también degrada a '—', nunca a '-'", () => {
  assert.equal(formatModelCell(null, {}), "—");
  assert.equal(formatModelCell(undefined, {}), "—");
  assert.equal(formatModelCell("", {}), "—");
});
