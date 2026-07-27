import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFieldbeatQualityFilters, buildFieldbeatQualityConditions } from "../../lib/fieldbeat-quality-filters.ts";
import { createParamPusher } from "../../lib/dashboard-filters.ts";

function sp(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

test("sin parámetros: filtros vacíos, sin errores", () => {
  const { filters, errors } = parseFieldbeatQualityFilters(sp({}));
  assert.deepEqual(errors, []);
  assert.deepEqual(filters, {
    dateFrom: undefined,
    dateTo: undefined,
    technician: undefined,
    technicianRole: undefined,
    client: undefined,
    equipment: undefined,
    taskType: undefined,
    origin: undefined,
    ticketStatus: undefined,
    partStatus: undefined,
    qualityStatus: undefined,
    inconsistencyCode: undefined,
    severity: undefined
  });
});

// HOTFIX de integridad de datos FieldBeat (§ propagación de participantes,
// Stage 7) - technicianRole distingue explícitamente "responsable
// principal" de "cualquier participante", nunca un filtro de técnico que
// silenciosamente se limita al principal sin comunicarlo.
test("technicianRole: acepta primary/additional/any, valor desconocido se rechaza", () => {
  for (const role of ["primary", "additional", "any"] as const) {
    const ok = parseFieldbeatQualityFilters(sp({ technicianRole: role }));
    assert.equal(ok.filters.technicianRole, role);
    assert.deepEqual(ok.errors, []);
  }
  const bad = parseFieldbeatQualityFilters(sp({ technicianRole: "bogus" }));
  assert.equal(bad.filters.technicianRole, undefined);
  assert.equal(bad.errors.length, 1);
});

test("fechas válidas se aceptan tal cual", () => {
  const { filters, errors } = parseFieldbeatQualityFilters(sp({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }));
  assert.deepEqual(errors, []);
  assert.equal(filters.dateFrom, "2026-01-01");
  assert.equal(filters.dateTo, "2026-01-31");
});

test("fecha con formato inválido se rechaza con error explícito, nunca se ignora en silencio", () => {
  const { filters, errors } = parseFieldbeatQualityFilters(sp({ dateFrom: "01/01/2026" }));
  assert.equal(filters.dateFrom, undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /dateFrom/);
});

test("dateFrom posterior a dateTo es un error", () => {
  const { errors } = parseFieldbeatQualityFilters(sp({ dateFrom: "2026-02-01", dateTo: "2026-01-01" }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /dateFrom no puede ser posterior/);
});

test("enum allowlist: valor conocido se acepta, valor desconocido se rechaza (nunca pasa silenciosamente)", () => {
  const ok = parseFieldbeatQualityFilters(sp({ ticketStatus: "accessible" }));
  assert.equal(ok.filters.ticketStatus, "accessible");
  assert.deepEqual(ok.errors, []);

  const bad = parseFieldbeatQualityFilters(sp({ ticketStatus: "bogus" }));
  assert.equal(bad.filters.ticketStatus, undefined);
  assert.equal(bad.errors.length, 1);
});

test("severity e inconsistencyCode usan la MISMA taxonomía que lib/fieldbeat-inconsistency-taxonomy.ts", () => {
  const ok = parseFieldbeatQualityFilters(sp({ severity: "Alta", inconsistencyCode: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY" }));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.filters.severity, "Alta");
  assert.equal(ok.filters.inconsistencyCode, "TEMPORAL_IMPOSSIBLE_CHRONOLOGY");

  const bad = parseFieldbeatQualityFilters(sp({ inconsistencyCode: "NOT_A_REAL_CODE" }));
  assert.equal(bad.errors.length, 1);
});

test("strings libres se normalizan (trim) y un string vacío tras trim se trata como ausente", () => {
  const { filters, errors } = parseFieldbeatQualityFilters(sp({ client: "  Cliente X  ", technician: "   " }));
  assert.equal(filters.client, "Cliente X");
  assert.equal(filters.technician, undefined);
  assert.deepEqual(errors, []);
});

test("string libre que excede el largo máximo se rechaza", () => {
  const { filters, errors } = parseFieldbeatQualityFilters(sp({ client: "x".repeat(500) }));
  assert.equal(filters.client, undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /excede el largo máximo/);
});

test("buildFieldbeatQualityConditions: sin filtros no genera condiciones", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({}, "q", pusher);
  assert.deepEqual(conditions, []);
  assert.deepEqual(pusher.params, []);
});

test("buildFieldbeatQualityConditions: dateTo es inclusivo del día completo (< dateTo + 1 día)", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ dateTo: "2026-01-31" }, "q", pusher);
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /INTERVAL '1 day'/);
  assert.deepEqual(pusher.params, ["2026-01-31"]);
});

test("buildFieldbeatQualityConditions: todo valor viaja parametrizado, nunca interpolado literal en el SQL", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ client: "Robert'); DROP TABLE x;--" }, "q", pusher);
  assert.equal(conditions.length, 1);
  assert.ok(!conditions[0].includes("DROP TABLE"), "el valor nunca debe aparecer interpolado en el texto SQL");
  assert.equal(pusher.params[0], "Robert'); DROP TABLE x;--");
});

test("buildFieldbeatQualityConditions: severity e inconsistencyCode generan subqueries contra las vistas de inconsistencias, no contra columnas inexistentes", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ severity: "Alta", inconsistencyCode: "PART_NO_MATCH" }, "q", pusher);
  assert.equal(conditions.length, 2);
  assert.match(conditions.join(" "), /fieldbeat_report_primary_inconsistency/);
  assert.match(conditions.join(" "), /fieldbeat_report_inconsistencies/);
});

// Caso de regresión 3453: Manuel Reyes (responsable principal, assigned_to)
// vs. Alexis Acevedo (adicional vía "OTROS (COMENTE)") - technicianRole
// debe distinguirlos explícitamente, nunca colapsar el filtro a "solo
// principal" sin que el consumidor lo pida.
// Regresión real (encontrada por la prueba de integración, no por una
// unitaria - por eso ahora se verifica explícitamente acá): pusher.params
// debe tener EXACTAMENTE tantos elementos como placeholders $N aparecen en
// el SQL producido - empujar un parámetro para una rama no usada (ej.
// 'additional' cuando role='primary') deja pusher.params desalineado del
// SQL real, y Postgres rechaza el bind ("supplies N parameters, but
// prepared statement requires M").
function countPlaceholders(sql: string): number {
  const matches = sql.match(/\$\d+/g) ?? [];
  return new Set(matches).size;
}

test("buildFieldbeatQualityConditions: technician con technicianRole='primary' (o sin especificar) preserva EXACTAMENTE la condición histórica sobre technician_names", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ technician: "Manuel Reyes", technicianRole: "primary" }, "q", pusher);
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /q\.technician_names ILIKE/);
  assert.doesNotMatch(conditions[0], /fieldbeat_report_participants/, "'primary' nunca debe considerar participantes adicionales");
  assert.equal(pusher.params.length, countPlaceholders(conditions.join(" ")), "pusher.params nunca debe traer más/menos elementos que placeholders $N reales - romperia el bind real de Postgres");
});

test("buildFieldbeatQualityConditions: technician con technicianRole='additional' consulta SOLO quality.fieldbeat_report_participants (is_primary=false), nunca technician_names", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ technician: "Alexis Acevedo", technicianRole: "additional" }, "q", pusher);
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /fieldbeat_report_participants/);
  assert.match(conditions[0], /is_primary\s*=\s*false/);
  assert.doesNotMatch(conditions[0], /technician_names/, "'additional' nunca debe caer de vuelta al responsable principal");
  assert.equal(pusher.params.length, countPlaceholders(conditions.join(" ")));
});

test("buildFieldbeatQualityConditions: technician con technicianRole='any' (o default) combina AMBAS condiciones - encuentra tanto al principal como a un adicional", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ technician: "Manuel Reyes" }, "q", pusher);
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /q\.technician_names ILIKE/);
  assert.match(conditions[0], /fieldbeat_report_participants/, "default (sin technicianRole) debe ser 'any', considera también participantes adicionales");
  assert.equal(pusher.params.length, countPlaceholders(conditions.join(" ")));
});

test("buildFieldbeatQualityConditions: sin filtro technician, technicianRole solo no genera ninguna condición", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions({ technicianRole: "additional" }, "q", pusher);
  assert.deepEqual(conditions, []);
});

test("buildFieldbeatQualityConditions: múltiples filtros combinados no colisionan en la numeración de parámetros", () => {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions(
    { dateFrom: "2026-01-01", dateTo: "2026-01-31", client: "ACME", taskType: "PM" },
    "q",
    pusher
  );
  assert.equal(conditions.length, 4);
  assert.equal(pusher.params.length, 4);
  assert.deepEqual(pusher.params, ["2026-01-01", "2026-01-31", "ACME", "PM"]);
});
