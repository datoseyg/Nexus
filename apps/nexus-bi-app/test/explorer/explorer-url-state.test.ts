import { test } from "node:test";
import assert from "node:assert/strict";
import { readExplorerUrlState, buildExplorerQueryString, DEFAULT_EXPLORER_ENTITY } from "../../lib/explorer-url-state.ts";

function sp(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

// `key` (detalle abierto) - agregado para que "Ver equipo"/"Ver cliente"
// navegue reemplazando el contenido vía URL canónica (ExplorerShell.
// navigateToDetail) en vez de apilar un segundo drawer sobre el que ya
// está abierto (sección 10 de la corrección de identidad de Equipos).
test("sin key en la URL, el detalle no está abierto", () => {
  assert.equal(readExplorerUrlState(sp({})).key, undefined);
});

test("key presente en la URL sobrevive el round-trip completo", () => {
  const state = readExplorerUrlState(sp({ entity: "equipment", key: "FUNDACION ARTURO LOPEZ PEREZ::LINAC-153038" }));
  assert.equal(state.key, "FUNDACION ARTURO LOPEZ PEREZ::LINAC-153038");
  const qs = buildExplorerQueryString(state);
  const roundTripped = readExplorerUrlState(new URLSearchParams(qs));
  assert.equal(roundTripped.key, state.key);
  assert.equal(roundTripped.entity, state.entity);
});

test("cambiar de entidad sin pasar key nunca arrastra la key anterior en la query generada", () => {
  const qs = buildExplorerQueryString({ entity: "clients", page: 1, q: "", filters: {}, key: undefined });
  assert.ok(!qs.includes("key="), "sin key, la query string nunca debe incluir el parámetro key");
});

test("entidad por defecto nunca escribe entity= en la URL (comportamiento ya existente, no debe romperse por el campo key nuevo)", () => {
  const qs = buildExplorerQueryString({ entity: DEFAULT_EXPLORER_ENTITY, page: 1, q: "", filters: {}, key: undefined });
  assert.equal(qs, "");
});

// Filtros completos del Explorador (NEXUS V3, sección 13/14) - un filtro
// nuevo agregado a EXPLORER_FILTER_KEYS debe sobrevivir el round-trip sin
// tocar readExplorerUrlState/buildExplorerQueryString a mano por cada clave
// (ambas ya son genéricas sobre EXPLORER_FILTER_KEYS) - esta prueba cubre
// una muestra representativa de cada "familia" (boolean/select/enum
// compartido entre entidades), no las ~30 claves una por una.
test("filtros booleanos ('true'/'false') sobreviven el round-trip completo", () => {
  const state = readExplorerUrlState(sp({ entity: "clients", hasEquipment: "true", hasActiveIssues: "false" }));
  assert.equal(state.filters.hasEquipment, "true");
  assert.equal(state.filters.hasActiveIssues, "false");
  const roundTripped = readExplorerUrlState(new URLSearchParams(buildExplorerQueryString(state)));
  assert.deepEqual(roundTripped.filters, state.filters);
});

test("claves reutilizadas entre entidades (client/matchStatus/dateFrom) viajan como un solo valor de texto, sin acoplarse a la entidad activa", () => {
  const state = readExplorerUrlState(sp({ entity: "parts", client: "ACME", matchStatus: "NO_PART_USED", dateFrom: "2026-01-01" }));
  assert.equal(state.filters.client, "ACME");
  assert.equal(state.filters.matchStatus, "NO_PART_USED");
  assert.equal(state.filters.dateFrom, "2026-01-01");
});

test("un filtro con valor vacío nunca se escribe en la query string (mismo criterio que los filtros existentes)", () => {
  const qs = buildExplorerQueryString({ entity: "equipment", page: 1, q: "", filters: { equipmentType: "", model: undefined }, key: undefined });
  assert.ok(!qs.includes("equipmentType="));
  assert.ok(!qs.includes("model="));
});
