import { test } from "node:test";
import assert from "node:assert/strict";
import { activeQuickRangeKey, buildFilterChips, buildQuickRanges, EMPTY_FILTERS } from "../../lib/after-hours-filter-state.ts";

// === Rangos rápidos (§7) ===

test("buildQuickRanges: expone exactamente las 6 llaves del encargo, en orden", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  assert.deepEqual(
    ranges.map(r => r.key),
    ["all", "month", "3m", "6m", "year", "prevYear"]
  );
});

test("buildQuickRanges: 'Todo' no lleva from/to (sin límites, nunca fechas fijas)", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  const all = ranges.find(r => r.key === "all")!;
  assert.equal(all.from, undefined);
  assert.equal(all.to, undefined);
});

test("buildQuickRanges: 'Este mes' calcula from real del 1° del mes actual, to = hoy", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  const month = ranges.find(r => r.key === "month")!;
  assert.equal(month.from, "2026-07-01");
  assert.equal(month.to, "2026-07-16");
});

test("buildQuickRanges: 'Año anterior' es un rango cerrado del 1-ene al 31-dic del año previo", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  const prevYear = ranges.find(r => r.key === "prevYear")!;
  assert.equal(prevYear.from, "2025-01-01");
  assert.equal(prevYear.to, "2025-12-31");
});

test("buildQuickRanges: 'Últimos 3 meses'/'Últimos 6 meses' terminan hoy y no se calculan con strings fijos (dependen de `now`)", () => {
  const rangesA = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  const rangesB = buildQuickRanges(new Date("2026-01-05T12:00:00Z"));
  const m3A = rangesA.find(r => r.key === "3m")!;
  const m3B = rangesB.find(r => r.key === "3m")!;
  assert.notEqual(m3A.from, m3B.from);
  assert.equal(m3A.to, "2026-07-16");
  assert.equal(m3B.to, "2026-01-05");
});

// === Rango activo (resaltado del botón) ===

test("activeQuickRangeKey: sin from/to -> 'all'", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  assert.equal(activeQuickRangeKey(ranges, {}), "all");
});

test("activeQuickRangeKey: from/to que coincide exacto con un preset retorna esa key", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  const key = activeQuickRangeKey(ranges, { from: "2026-07-01", to: "2026-07-16" });
  assert.equal(key, "month");
});

test("activeQuickRangeKey: rango custom que no calza con ningún preset retorna null (no 'all')", () => {
  const ranges = buildQuickRanges(new Date("2026-07-16T12:00:00Z"));
  const key = activeQuickRangeKey(ranges, { from: "2025-03-01", to: "2025-03-15" });
  assert.equal(key, null);
});

// === EMPTY_FILTERS ===

test("EMPTY_FILTERS: objeto vacío, sin ningún filtro activo por defecto", () => {
  assert.deepEqual(EMPTY_FILTERS, {});
});

// === Chips de filtros aplicados (§7) ===

test("buildFilterChips: sin filtros activos, 0 chips", () => {
  assert.deepEqual(buildFilterChips({}), []);
});

test("buildFilterChips: un chip por cada campo activo, con id estable", () => {
  const chips = buildFilterChips({ client: "Cliente X", onlyAfterHours: true, fallbackUsed: true });
  assert.deepEqual(
    chips.map(c => c.id),
    ["client", "onlyAfterHours", "fallbackUsed"]
  );
  assert.equal(chips[0].label, "Cliente: Cliente X");
});

test("buildFilterChips: checkboxes en false no generan chip (solo true genera chip)", () => {
  const chips = buildFilterChips({ onlyAfterHours: false, onlyLowConfidence: false, fallbackUsed: false });
  assert.deepEqual(chips, []);
});

test("buildFilterChips: dataBasis/coverageReasonCode/contractualReasonCode muestran texto legible, no el código crudo", () => {
  const chips = buildFilterChips({ dataBasis: "LEGACY_SCHEDULE", coverageReasonCode: "WITHIN_LEGACY_SCHEDULE" });
  const dataBasisChip = chips.find(c => c.id === "dataBasis")!;
  const reasonChip = chips.find(c => c.id === "coverageReasonCode")!;
  assert.ok(!dataBasisChip.label.includes("LEGACY_SCHEDULE"), `no debería exponer el código crudo: ${dataBasisChip.label}`);
  assert.ok(!reasonChip.label.includes("WITHIN_LEGACY_SCHEDULE"), `no debería exponer el código crudo: ${reasonChip.label}`);
});

test("buildFilterChips: todos los campos activos a la vez producen 10 chips (uno por campo del estado)", () => {
  const chips = buildFilterChips({
    client: "C1",
    technician: "T1",
    taskType: "PM",
    dataBasis: "CONTRACTUAL",
    confidenceLevel: "Alta",
    onlyAfterHours: true,
    onlyLowConfidence: true,
    fallbackUsed: true,
    coverageReasonCode: "WITHIN_MATCHED_CONTRACT",
    contractualReasonCode: "WITHIN_MATCHED_CONTRACT"
  });
  assert.equal(chips.length, 10);
});

// === weekday/hour (ETAPA 6.6D) ===

test("buildFilterChips: weekday solo (seteado desde el gráfico de día de la semana, sin hour) -> 1 chip 'Día: X'", () => {
  const chips = buildFilterChips({ weekday: 3 });
  assert.deepEqual(chips.map(c => c.id), ["weekday"]);
  assert.equal(chips[0].label, "Día: Miércoles");
});

test("buildFilterChips: weekday+hour (seteados juntos desde el heatmap) -> UN SOLO chip compuesto, no dos", () => {
  const chips = buildFilterChips({ weekday: 1, hour: 14 });
  assert.deepEqual(chips.map(c => c.id), ["weekdayHour"]);
  assert.ok(chips[0].label.includes("Lunes"));
  assert.ok(chips[0].label.includes("14:00"));
});

test("buildFilterChips: hour=0 (medianoche) SÍ genera el chip compuesto - nunca se trata como ausente por ser falsy", () => {
  const chips = buildFilterChips({ weekday: 2, hour: 0 });
  assert.deepEqual(chips.map(c => c.id), ["weekdayHour"]);
  assert.ok(chips[0].label.includes("00:00"));
});

test("buildFilterChips: technician+client seteados a la vez (selección de un par en el ranking) siguen siendo DOS chips independientes, nunca fusionados", () => {
  const chips = buildFilterChips({ technician: "tech1", client: "Cliente X" });
  assert.deepEqual(chips.map(c => c.id).sort(), ["client", "technician"]);
});
