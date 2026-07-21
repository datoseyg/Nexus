import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAfterHoursQuery } from "../../lib/after-hours-query.ts";
import { buildQuickRanges, EMPTY_FILTERS, type AfterHoursFilterState } from "../../lib/after-hours-filter-state.ts";

// ETAPA 6.6D-FIX-1 - summary, by-technician y by-client (y todas las demás
// secciones) consumen EXACTAMENTE el mismo string de query construido acá
// (AfterHoursShell.tsx: `filtersQuery = toQuery(filters)` compartido) -
// verificar esta función una vez cubre las tres rutas por construcción, no
// hace falta una copia de test por endpoint.

test("buildAfterHoursQuery: sin filtros -> query vacía (nunca 'undefined' literal)", () => {
  assert.equal(buildAfterHoursQuery(EMPTY_FILTERS), "");
});

test("buildAfterHoursQuery: from/to presentes cuando el filtro tiene un rango de fechas activo", () => {
  const filters: AfterHoursFilterState = { from: "2026-07-01", to: "2026-07-31" };
  const query = buildAfterHoursQuery(filters);
  const params = new URLSearchParams(query);
  assert.equal(params.get("from"), "2026-07-01");
  assert.equal(params.get("to"), "2026-07-31");
});

test("buildAfterHoursQuery: todos los presets de buildQuickRanges (salvo 'Todo') serializan from/to correctamente", () => {
  const now = new Date("2026-07-19T12:00:00Z");
  const ranges = buildQuickRanges(now);
  for (const range of ranges) {
    const query = buildAfterHoursQuery({ ...EMPTY_FILTERS, from: range.from, to: range.to });
    const params = new URLSearchParams(query);
    if (range.key === "all") {
      assert.equal(params.has("from"), false, `preset "${range.label}" no debería tener from`);
      assert.equal(params.has("to"), false, `preset "${range.label}" no debería tener to`);
    } else {
      assert.equal(params.get("from"), range.from, `preset "${range.label}" perdió from`);
      assert.equal(params.get("to"), range.to, `preset "${range.label}" perdió to`);
    }
  }
});

test("buildAfterHoursQuery: technician/client van juntos a la query cuando ambos están activos, sin pisarse", () => {
  const query = buildAfterHoursQuery({ technician: "tech1", client: "Cliente Legacy" });
  const params = new URLSearchParams(query);
  assert.equal(params.get("technician"), "tech1");
  assert.equal(params.get("client"), "Cliente Legacy");
});

test("buildAfterHoursQuery: hour=0 (medianoche) se serializa, nunca se omite por ser falsy", () => {
  const query = buildAfterHoursQuery({ weekday: 3, hour: 0 });
  const params = new URLSearchParams(query);
  assert.equal(params.get("hour"), "0");
  assert.equal(params.get("weekday"), "3");
});

test("buildAfterHoursQuery: extra (page/pageSize/sortBy) se agrega sin pisar los filtros base", () => {
  const query = buildAfterHoursQuery({ from: "2026-01-01", to: "2026-01-31" }, { page: 2, pageSize: 20 });
  const params = new URLSearchParams(query);
  assert.equal(params.get("from"), "2026-01-01");
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("pageSize"), "20");
});
