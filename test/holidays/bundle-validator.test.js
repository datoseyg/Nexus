import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBundle, SCHEMA_VERSION } from "../../src/holidays/bundle-validator.js";

function baseBundle(overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    jurisdiction: "CL",
    coverage_start: "2026-01-01",
    coverage_end_exclusive: "2027-01-01",
    sources: [{ source_id: "src-1", authority: "Gobierno de Chile", title: "Calendario oficial", url: "https://www.gob.cl/x", accessed_at: "2026-07-15" }],
    events: [
      { local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", is_irrenunciable: true, source_ids: ["src-1"] }
    ],
    ...overrides
  };
}

test("bundle mínimo válido -> ok", () => {
  const r = validateBundle(baseBundle());
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.resolvedEvents.length, 1);
  assert.equal(r.resolvedEvents[0].source_event_key, "CL:2026-01-01:FIXED_DATE:ano-nuevo");
});

test("schema_version incorrecto -> rechazado", () => {
  const r = validateBundle(baseBundle({ schema_version: "otra-cosa" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("schema_version")));
});

test("rango de cobertura inválido (start >= end) -> rechazado", () => {
  const r = validateBundle(baseBundle({ coverage_start: "2027-01-01", coverage_end_exclusive: "2026-01-01" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("Rango de cobertura inválido")));
});

test("evento fuera del coverage range -> rechazado", () => {
  const r = validateBundle(baseBundle({
    events: [{ local_date: "2027-06-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", source_ids: ["src-1"] }]
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("cae fuera del rango de cobertura")));
});

test("source_id inexistente referenciado por un evento -> rechazado", () => {
  const r = validateBundle(baseBundle({
    events: [{ local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", source_ids: ["src-inexistente"] }]
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("no existe en sources")));
});

test("categoría de holiday_type no representable -> rechazada", () => {
  const r = validateBundle(baseBundle({
    events: [{ local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "NO_EXISTE", source_ids: ["src-1"] }]
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("no es una categoría representable")));
});

test("2 eventos coincidentes en la misma fecha con nombres distintos -> permitido", () => {
  const r = validateBundle(baseBundle({
    events: [
      { local_date: "2026-09-18", holiday_name: "Independencia Nacional", holiday_type: "FIXED_DATE", source_ids: ["src-1"] },
      { local_date: "2026-09-18", holiday_name: "Feriado Regional de Ejemplo", holiday_type: "REGIONAL", source_ids: ["src-1"] }
    ]
  }));
  assert.equal(r.ok, true);
  assert.equal(r.resolvedEvents.length, 2);
  assert.notEqual(r.resolvedEvents[0].source_event_key, r.resolvedEvents[1].source_event_key);
});

test("duplicado exacto (mismo source_event_key resultante) -> rechazado", () => {
  const r = validateBundle(baseBundle({
    events: [
      { local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", source_ids: ["src-1"] },
      { local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", source_ids: ["src-1"] }
    ]
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("Evento duplicado exacto")));
});

test("evento sin ninguna fuente referenciada -> rechazado", () => {
  const r = validateBundle(baseBundle({
    events: [{ local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", source_ids: [] }]
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("no referencia ninguna fuente")));
});

test("is_irrenunciable no booleano -> rechazado", () => {
  const r = validateBundle(baseBundle({
    events: [{ local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", is_irrenunciable: "si", source_ids: ["src-1"] }]
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("is_irrenunciable")));
});

test("ELECTION y ONE_OFF son categorías representables", () => {
  const r = validateBundle(baseBundle({
    coverage_start: "2023-01-01",
    coverage_end_exclusive: "2024-01-01",
    events: [
      { local_date: "2023-12-17", holiday_name: "Plebiscito Constitucional 2023", holiday_type: "ELECTION", source_ids: ["src-1"] },
      { local_date: "2023-05-07", holiday_name: "Elección Consejo Constitucional", holiday_type: "ONE_OFF", source_ids: ["src-1"] }
    ]
  }));
  assert.equal(r.ok, true);
});

test("eventos fuera de orden -> warning, no error", () => {
  const r = validateBundle(baseBundle({
    events: [
      { local_date: "2026-12-25", holiday_name: "Navidad", holiday_type: "FIXED_DATE", source_ids: ["src-1"] },
      { local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", source_ids: ["src-1"] }
    ]
  }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => w.includes("no están ordenados")));
});
