import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForKey, deriveSourceEventKey } from "../../src/holidays/source-event-key.js";

test("normalizeForKey elimina tildes y usa minúsculas/guiones", () => {
  assert.equal(normalizeForKey("Año Nuevo"), "ano-nuevo");
  assert.equal(normalizeForKey("San Pedro y San Pablo"), "san-pedro-y-san-pablo");
  assert.equal(normalizeForKey("  Día de la Virgen del Carmen  "), "dia-de-la-virgen-del-carmen");
});

test("deriveSourceEventKey es determinística: mismo evento -> misma clave", () => {
  const a = deriveSourceEventKey({ jurisdiction: "CL", localDate: "2026-01-01", holidayType: "FIXED_DATE", holidayName: "Año Nuevo" });
  const b = deriveSourceEventKey({ jurisdiction: "CL", localDate: "2026-01-01", holidayType: "FIXED_DATE", holidayName: "Año Nuevo" });
  assert.equal(a, b);
  assert.equal(a, "CL:2026-01-01:FIXED_DATE:ano-nuevo");
});

test("distinta fecha produce distinta clave", () => {
  const a = deriveSourceEventKey({ jurisdiction: "CL", localDate: "2026-01-01", holidayType: "FIXED_DATE", holidayName: "Año Nuevo" });
  const b = deriveSourceEventKey({ jurisdiction: "CL", localDate: "2027-01-01", holidayType: "FIXED_DATE", holidayName: "Año Nuevo" });
  assert.notEqual(a, b);
});

test("2 eventos coincidentes en la misma fecha con nombres distintos producen claves distintas", () => {
  const a = deriveSourceEventKey({ jurisdiction: "CL", localDate: "2026-09-18", holidayType: "FIXED_DATE", holidayName: "Independencia Nacional" });
  const b = deriveSourceEventKey({ jurisdiction: "CL_ARICA", localDate: "2026-09-18", holidayType: "REGIONAL", holidayName: "Feriado Regional Ejemplo" });
  assert.notEqual(a, b);
});

test("explicitId, cuando existe, se usa tal cual (nunca se recalcula)", () => {
  const key = deriveSourceEventKey({ jurisdiction: "CL", localDate: "2026-01-01", holidayType: "FIXED_DATE", holidayName: "Año Nuevo", explicitId: "SERVEL:2026-eleccion-x" });
  assert.equal(key, "SERVEL:2026-eleccion-x");
});
