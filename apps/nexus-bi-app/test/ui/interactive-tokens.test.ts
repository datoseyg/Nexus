import { test } from "node:test";
import assert from "node:assert/strict";
import * as interactive from "@/components/ui/interactive";

// Resguardo de regresión sobre el CONTRATO de las constantes de
// components/ui/interactive.ts (strings de clases Tailwind) - no renderiza
// ningún componente ni verifica comportamiento real en el DOM (hover/focus/
// click). Esa parte se valida a mano contra npm run dev:local (ver reporte
// final) porque el runner de tests de este repo (node --experimental-strip-types,
// sin jsdom) no puede montar JSX real - mismo límite ya documentado en
// test/layout/root-layout-catch-isolation.test.ts.

const BUTTON_CONSTANTS = {
  BUTTON_PRIMARY: interactive.BUTTON_PRIMARY,
  BUTTON_SECONDARY: interactive.BUTTON_SECONDARY,
  BUTTON_GHOST: interactive.BUTTON_GHOST,
  BUTTON_TEXT: interactive.BUTTON_TEXT,
  BUTTON_ICON: interactive.BUTTON_ICON,
  BUTTON_DESTRUCTIVE: interactive.BUTTON_DESTRUCTIVE,
  BUTTON_PAGINATION: interactive.BUTTON_PAGINATION,
  BUTTON_SORT: interactive.BUTTON_SORT,
  BUTTON_FILTER: interactive.BUTTON_FILTER,
  BUTTON_FILTER_SELECTED: interactive.BUTTON_FILTER_SELECTED,
  BUTTON_CHROME: interactive.BUTTON_CHROME
};

test("BASE_TRANSITION respeta prefers-reduced-motion por clase", () => {
  assert.match(interactive.BASE_TRANSITION, /motion-reduce:transition-none/);
  assert.match(interactive.BASE_TRANSITION, /motion-reduce:transform-none/);
  assert.match(interactive.BASE_TRANSITION, /duration-150/);
});

test("FOCUS_RING usa el mecanismo ring (no doble anillo con el fallback global outline)", () => {
  assert.match(interactive.FOCUS_RING, /focus-visible:outline-none/);
  assert.match(interactive.FOCUS_RING, /focus-visible:ring-2/);
  assert.match(interactive.FOCUS_RING, /--nx-focus-ring-color/);
});

test("cada botón compartido incluye tratamiento disabled real (no solo visual)", () => {
  for (const [name, value] of Object.entries(BUTTON_CONSTANTS)) {
    assert.match(value, /disabled:cursor-not-allowed/, `${name} sin disabled:cursor-not-allowed`);
    assert.match(value, /disabled:opacity-\d/, `${name} sin disabled:opacity-*`);
  }
});

test("cada botón compartido incluye hover Y focus-visible (no solo uno)", () => {
  for (const [name, value] of Object.entries(BUTTON_CONSTANTS)) {
    assert.match(value, /hover:/, `${name} sin estado hover`);
    assert.match(value, /focus-visible:/, `${name} sin focus-visible`);
  }
});

test("BUTTON_PRIMARY reacciona con brightness/shadow, nunca bg-*, para no chocar con background inline", () => {
  assert.match(interactive.BUTTON_PRIMARY, /hover:brightness-/);
  assert.doesNotMatch(interactive.BUTTON_PRIMARY, /hover:bg-/);
});

test("BUTTON_FILTER_SELECTED se distingue de BUTTON_FILTER en más que una opacidad (selected debe ser persistente)", () => {
  assert.match(interactive.BUTTON_FILTER_SELECTED, /bg-\[var\(--nx-accent-indigo\)\]/);
  assert.match(interactive.BUTTON_FILTER_SELECTED, /text-white/);
  assert.doesNotMatch(interactive.BUTTON_FILTER, /bg-\[var\(--nx-accent-indigo\)\]/);
});

test("PILL_SELECTED_DARK/GREEN y PILL_UNSELECTED (reexportadas por Búsqueda) siguen siendo distintas entre sí", () => {
  assert.notEqual(interactive.PILL_SELECTED_DARK, interactive.PILL_UNSELECTED);
  assert.notEqual(interactive.PILL_SELECTED_GREEN, interactive.PILL_UNSELECTED);
  assert.match(interactive.PILL_SELECTED_DARK, /text-white/);
  assert.match(interactive.PILL_UNSELECTED, /text-\[var\(--nx-text-secondary\)\]/);
});

test("CARD_INTERACTIVE no cambia background/border (preserva el acento propio de cada card)", () => {
  assert.doesNotMatch(interactive.CARD_INTERACTIVE, /hover:bg-/);
  assert.doesNotMatch(interactive.CARD_INTERACTIVE, /hover:border-/);
  assert.match(interactive.CARD_INTERACTIVE, /hover:shadow-md/);
});

test("ninguna constante usa scale, sombras grandes o transiciones largas", () => {
  const all = Object.values(BUTTON_CONSTANTS).concat([interactive.PILL_SELECTED_DARK, interactive.PILL_SELECTED_GREEN, interactive.PILL_UNSELECTED, interactive.CARD_INTERACTIVE]);
  for (const value of all) {
    assert.doesNotMatch(value, /hover:scale-/);
    assert.doesNotMatch(value, /shadow-(lg|xl|2xl)/);
    assert.doesNotMatch(value, /duration-(300|500|700|1000)/);
  }
});
