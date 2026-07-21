import { test } from "node:test";
import assert from "node:assert/strict";
import { createParamPusher } from "../../lib/dashboard-filters.ts";
import { buildFieldbeatMartConditions, buildFieldbeatOrigenSubquery, parseFieldbeatFilters } from "../../lib/fieldbeat-filters.ts";

test("parseFieldbeatFilters: sin query params, grain por defecto month y todo lo demás undefined", () => {
  const filters = parseFieldbeatFilters(new URLSearchParams());
  assert.deepEqual(filters, { from: undefined, to: undefined, grain: "month", cliente: undefined, equipo: undefined, tipoTarea: undefined, origen: undefined, conTicket: undefined, conRepuesto: undefined });
});

test("parseFieldbeatFilters: lee cliente/equipo/tipoTarea/from/to tal cual", () => {
  const filters = parseFieldbeatFilters(new URLSearchParams("cliente=ACME&equipo=EQ-1&tipoTarea=CORRECTIVA&from=2026-01-01&to=2026-06-30"));
  assert.equal(filters.cliente, "ACME");
  assert.equal(filters.equipo, "EQ-1");
  assert.equal(filters.tipoTarea, "CORRECTIVA");
  assert.equal(filters.from, "2026-01-01");
  assert.equal(filters.to, "2026-06-30");
});

test("parseFieldbeatFilters: origen solo acepta APK/WEB, cualquier otro valor se descarta", () => {
  assert.equal(parseFieldbeatFilters(new URLSearchParams("origen=APK")).origen, "APK");
  assert.equal(parseFieldbeatFilters(new URLSearchParams("origen=WEB")).origen, "WEB");
  assert.equal(parseFieldbeatFilters(new URLSearchParams("origen=INVENTADO")).origen, undefined);
});

test("parseFieldbeatFilters: conTicket/conRepuesto son tri-estado real (true/false/undefined), nunca truthy", () => {
  assert.equal(parseFieldbeatFilters(new URLSearchParams("conTicket=true")).conTicket, true);
  assert.equal(parseFieldbeatFilters(new URLSearchParams("conTicket=false")).conTicket, false);
  assert.equal(parseFieldbeatFilters(new URLSearchParams()).conTicket, undefined);
  assert.equal(parseFieldbeatFilters(new URLSearchParams("conRepuesto=false")).conRepuesto, false);
});

test("buildFieldbeatMartConditions: sin filtros, ninguna condición", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatMartConditions({ grain: "month" }, "m", pusher);
  assert.deepEqual(conditions, []);
  assert.deepEqual(pusher.params, []);
});

test("buildFieldbeatMartConditions: cliente/equipo/tipoTarea generan condiciones parametrizadas (nunca interpolación directa del valor)", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatMartConditions({ grain: "month", cliente: "ACME", equipo: "EQ-1", tipoTarea: "CORRECTIVA" }, "m", pusher);
  assert.equal(conditions.length, 3);
  assert.match(conditions[0], /^m\.client_name = \$1$/);
  assert.match(conditions[1], /^m\.task_type = \$2$/);
  assert.match(conditions[2], /^m\.equipment_internal_ids ILIKE \$3$/);
  assert.deepEqual(pusher.params, ["ACME", "CORRECTIVA", "%EQ-1%"]);
});

test("buildFieldbeatMartConditions: conTicket/conRepuesto son tri-estado real en SQL - false genera IS NULL/= 0, no se omite", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatMartConditions({ grain: "month", conTicket: false, conRepuesto: false }, "m", pusher);
  assert.ok(conditions.some(c => c.includes("linked_zendesk_ticket_id IS NULL")));
  assert.ok(conditions.some(c => c.includes("used_parts_count = 0")));
});

test("buildFieldbeatMartConditions: exclude implementa self-exclusion (mismo criterio que lib/dashboard-filters.ts)", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatMartConditions({ grain: "month", cliente: "ACME", tipoTarea: "CORRECTIVA" }, "m", pusher, ["cliente"]);
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /task_type/);
});

test("buildFieldbeatOrigenSubquery: null sin filtro de origen, subquery parametrizada con filtro", () => {
  const pusher1 = createParamPusher();
  assert.equal(buildFieldbeatOrigenSubquery({ grain: "month" }, "m", pusher1), null);

  const pusher2 = createParamPusher();
  const sub = buildFieldbeatOrigenSubquery({ grain: "month", origen: "APK" }, "m", pusher2);
  assert.match(sub!, /processed\.fieldbeat_tasks WHERE created_in = \$1/);
  assert.deepEqual(pusher2.params, ["APK"]);
});

test("buildFieldbeatOrigenSubquery: respeta exclude", () => {
  const pusher = createParamPusher();
  assert.equal(buildFieldbeatOrigenSubquery({ grain: "month", origen: "APK" }, "m", pusher, ["origen"]), null);
});
