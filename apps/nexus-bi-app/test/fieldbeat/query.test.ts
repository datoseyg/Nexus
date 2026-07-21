import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFieldbeatQuery } from "../../lib/fieldbeat-query.ts";

test("buildFieldbeatQuery: sin filtros, query vacía", () => {
  assert.equal(buildFieldbeatQuery({}), "");
});

test("buildFieldbeatQuery: serializa cada filtro activo", () => {
  const query = buildFieldbeatQuery({ cliente: "ACME", equipo: "EQ-1", tipoTarea: "CORRECTIVA", origen: "APK", from: "2026-01-01", to: "2026-06-30" });
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("cliente"), "ACME");
  assert.equal(parsed.get("equipo"), "EQ-1");
  assert.equal(parsed.get("tipoTarea"), "CORRECTIVA");
  assert.equal(parsed.get("origen"), "APK");
  assert.equal(parsed.get("from"), "2026-01-01");
  assert.equal(parsed.get("to"), "2026-06-30");
});

test("buildFieldbeatQuery: conTicket=false SÍ viaja en la query (tri-estado real, no se omite como falsy)", () => {
  const query = buildFieldbeatQuery({ conTicket: false });
  assert.equal(new URLSearchParams(query).get("conTicket"), "false");
});

test("buildFieldbeatQuery: extra (page/pageSize) se agrega sin pisar los filtros", () => {
  const query = buildFieldbeatQuery({ cliente: "ACME" }, { page: 2, pageSize: 20 });
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("cliente"), "ACME");
  assert.equal(parsed.get("page"), "2");
  assert.equal(parsed.get("pageSize"), "20");
});
