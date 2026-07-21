import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilterChips, EMPTY_FILTERS } from "../../lib/fieldbeat-filter-state.ts";

test("buildFilterChips: sin filtros, sin chips", () => {
  assert.deepEqual(buildFilterChips(EMPTY_FILTERS), []);
});

test("buildFilterChips: un chip por campo activo", () => {
  const chips = buildFilterChips({ cliente: "ACME", equipo: "EQ-1", tipoTarea: "CORRECTIVA", origen: "APK" });
  assert.equal(chips.length, 4);
  assert.deepEqual(chips.map(c => c.id).sort(), ["cliente", "equipo", "origen", "tipoTarea"]);
});

test("buildFilterChips: conTicket/conRepuesto son tri-estado - false SÍ genera chip (nunca se confunde con undefined)", () => {
  const chips = buildFilterChips({ conTicket: false, conRepuesto: true });
  assert.equal(chips.length, 2);
  const conTicket = chips.find(c => c.id === "conTicket")!;
  const conRepuesto = chips.find(c => c.id === "conRepuesto")!;
  assert.equal(conTicket.label, "Sin ticket asociado");
  assert.equal(conRepuesto.label, "Con repuesto registrado");
});

test("buildFilterChips: conTicket=false vs conTicket=undefined producen resultados distintos", () => {
  assert.equal(buildFilterChips({ conTicket: false }).length, 1);
  assert.equal(buildFilterChips({}).length, 0);
});
