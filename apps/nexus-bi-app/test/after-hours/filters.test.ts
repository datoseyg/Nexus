import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "../../lib/after-hours-filters.ts";

function qs(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

// === Filtros existentes (sin regresión, ETAPA 6.6C §7) ===

test("parseAfterHoursFilters: filtros existentes se parsean igual que antes", () => {
  const f = parseAfterHoursFilters(qs({ client: "Cliente X", technician: "Tech1", taskType: "PM", from: "2026-01-01", to: "2026-01-31", confidenceLevel: "Alta", onlyAfterHours: "true", onlyLowConfidence: "true" }));
  assert.equal(f.cliente, "Cliente X");
  assert.equal(f.tecnico, "Tech1");
  assert.equal(f.tipoTarea, "PM");
  assert.equal(f.from, "2026-01-01");
  assert.equal(f.to, "2026-01-31");
  assert.equal(f.confidenceLevel, "Alta");
  assert.equal(f.onlyAfterHours, true);
  assert.equal(f.onlyLowConfidence, true);
});

test("parseAfterHoursFilters: sin parámetros -> todos undefined/false", () => {
  const f = parseAfterHoursFilters(qs({}));
  assert.equal(f.cliente, undefined);
  assert.equal(f.onlyAfterHours, false);
  assert.equal(f.onlyLowConfidence, false);
  assert.equal(f.dataBasis, undefined);
  assert.equal(f.fallbackUsed, undefined);
});

test("buildAfterHoursMartConditions: filtros existentes generan las mismas condiciones que antes", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ client: "C1", onlyAfterHours: "true", onlyLowConfidence: "true" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
  assert.ok(conditions.some(c => c.includes("w.client_name = $1")));
  assert.ok(conditions.some(c => c === "w.is_after_hours_task = true"));
  assert.ok(conditions.some(c => c === "w.confidence_score < 65"));
});

test("onlyLowConfidence: la condición generada excluye NULL naturalmente (semántica de Postgres, confidence_score < 65 con NULL evalúa a NULL/false en WHERE)", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ onlyLowConfidence: "true" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
  const cond = conditions.find(c => c.includes("confidence_score"));
  assert.equal(cond, "w.confidence_score < 65");
  // No debe agregar un IS NOT NULL redundante - Postgres ya excluye NULL
  // en una comparación `<` (three-valued logic), verificado además en el
  // fixture de integración con una fila confidence_score=NULL.
  assert.ok(!cond?.includes("IS NOT NULL"));
});

// === Filtros aditivos (§4/§7) ===

test("parseAfterHoursFilters: dataBasis válido se acepta", () => {
  const f = parseAfterHoursFilters(qs({ dataBasis: "CONTRACTUAL" }));
  assert.equal(f.dataBasis, "CONTRACTUAL");
});

test("parseAfterHoursFilters: dataBasis inválido se ignora silenciosamente (no 400, mismo criterio laxo que confidenceLevel)", () => {
  const f = parseAfterHoursFilters(qs({ dataBasis: "ALGO_INVENTADO" }));
  assert.equal(f.dataBasis, undefined);
});

test("parseAfterHoursFilters: fallbackUsed true/false se parsean como boolean real", () => {
  assert.equal(parseAfterHoursFilters(qs({ fallbackUsed: "true" })).fallbackUsed, true);
  assert.equal(parseAfterHoursFilters(qs({ fallbackUsed: "false" })).fallbackUsed, false);
  assert.equal(parseAfterHoursFilters(qs({})).fallbackUsed, undefined);
});

test("parseAfterHoursFilters: coverageReasonCode/contractualReasonCode válidos se aceptan, inválidos se ignoran", () => {
  const valid = parseAfterHoursFilters(qs({ coverageReasonCode: "WITHIN_MATCHED_CONTRACT", contractualReasonCode: "EQUIPMENT_UNMATCHED" }));
  assert.equal(valid.coverageReasonCode, "WITHIN_MATCHED_CONTRACT");
  assert.equal(valid.contractualReasonCode, "EQUIPMENT_UNMATCHED");

  const invalid = parseAfterHoursFilters(qs({ coverageReasonCode: "NO_EXISTE", contractualReasonCode: "TAMPOCO_EXISTE" }));
  assert.equal(invalid.coverageReasonCode, undefined);
  assert.equal(invalid.contractualReasonCode, undefined);
});

test("contractualReasonCode nunca acepta WITHIN_LEGACY_SCHEDULE (no pertenece a ese vocabulario)", () => {
  const f = parseAfterHoursFilters(qs({ contractualReasonCode: "WITHIN_LEGACY_SCHEDULE" }));
  assert.equal(f.contractualReasonCode, undefined);
});

test("buildAfterHoursMartConditions: filtros aditivos generan condiciones parametrizadas, nunca interpoladas", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ dataBasis: "LEGACY_SCHEDULE", fallbackUsed: "true", coverageReasonCode: "WITHIN_LEGACY_SCHEDULE" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);

  assert.ok(conditions.includes("w.data_basis = $1"));
  assert.ok(conditions.includes("w.fallback_used = $2"));
  assert.ok(conditions.includes("w.coverage_reason_code = $3"));
  assert.deepEqual(pusher.params, ["LEGACY_SCHEDULE", true, "WITHIN_LEGACY_SCHEDULE"]);
});

test("buildAfterHoursMartConditions: sin filtros aditivos, comportamiento idéntico al de antes de 6.6C (mismas 0 condiciones extra)", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({}));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
  assert.equal(conditions.length, 0);
  assert.equal(pusher.params.length, 0);
});

test("createParamPusher: cada valor pusheado obtiene un placeholder $N secuencial único, sin colisiones", () => {
  const pusher = createParamPusher();
  const a = pusher.push("x");
  const b = pusher.push("y");
  const c = pusher.push("z");
  assert.deepEqual([a, b, c], ["$1", "$2", "$3"]);
  assert.deepEqual(pusher.params, ["x", "y", "z"]);
});

// === weekday/hour (ETAPA 6.6D) ===

test("parseAfterHoursFilters: weekday 1..7 válido se acepta", () => {
  assert.equal(parseAfterHoursFilters(qs({ weekday: "1" })).weekday, 1);
  assert.equal(parseAfterHoursFilters(qs({ weekday: "7" })).weekday, 7);
});

test("parseAfterHoursFilters: weekday fuera de rango (0, 8, -1, no-numérico) se ignora silenciosamente, nunca 400", () => {
  assert.equal(parseAfterHoursFilters(qs({ weekday: "0" })).weekday, undefined);
  assert.equal(parseAfterHoursFilters(qs({ weekday: "8" })).weekday, undefined);
  assert.equal(parseAfterHoursFilters(qs({ weekday: "-1" })).weekday, undefined);
  assert.equal(parseAfterHoursFilters(qs({ weekday: "abc" })).weekday, undefined);
});

test("parseAfterHoursFilters: hour=0 parsea a 0 (medianoche), NUNCA a undefined - trampa de truthiness", () => {
  const f = parseAfterHoursFilters(qs({ hour: "0" }));
  assert.equal(f.hour, 0);
  assert.notEqual(f.hour, undefined);
});

test("parseAfterHoursFilters: hour 1..23 válido se acepta, fuera de rango (24, -1, no-numérico) se ignora", () => {
  assert.equal(parseAfterHoursFilters(qs({ hour: "23" })).hour, 23);
  assert.equal(parseAfterHoursFilters(qs({ hour: "24" })).hour, undefined);
  assert.equal(parseAfterHoursFilters(qs({ hour: "-1" })).hour, undefined);
  assert.equal(parseAfterHoursFilters(qs({ hour: "abc" })).hour, undefined);
});

test("parseAfterHoursFilters: sin weekday/hour -> ambos undefined", () => {
  const f = parseAfterHoursFilters(qs({}));
  assert.equal(f.weekday, undefined);
  assert.equal(f.hour, undefined);
});

test("buildAfterHoursMartConditions: weekday/hour generan condiciones EXTRACT parametrizadas", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ weekday: "3", hour: "0" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
  assert.ok(conditions.some(c => c.includes("EXTRACT(ISODOW FROM w.start_time_local)") && c.includes("$1")));
  assert.ok(conditions.some(c => c.includes("EXTRACT(HOUR FROM w.start_time_local)") && c.includes("$2")));
  assert.deepEqual(pusher.params, [3, 0]);
});

// === exclude (autoexclusión, ETAPA 6.6D) ===

test("buildAfterHoursMartConditions: exclude por defecto ([]) es idéntico al comportamiento actual (regresión)", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ client: "C1", technician: "T1", taskType: "PM" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
  assert.equal(conditions.length, 3);
  assert.equal(pusher.params.length, 3);
});

test("buildAfterHoursMartConditions: exclude=['tecnico'] omite SOLO la condición de técnico, conserva las demás", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ client: "C1", technician: "T1", taskType: "PM" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher, ["tecnico"]);
  assert.ok(!conditions.some(c => c.includes("assigned_to")));
  assert.ok(conditions.some(c => c.includes("client_name")));
  assert.ok(conditions.some(c => c.includes("task_type")));
});

test("buildAfterHoursMartConditions: exclude=['weekday','hour'] omite ambas condiciones de tiempo compuesto", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ weekday: "3", hour: "14", client: "C1" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher, ["weekday", "hour"]);
  assert.ok(!conditions.some(c => c.includes("ISODOW")));
  assert.ok(!conditions.some(c => c.includes("EXTRACT(HOUR")));
  assert.ok(conditions.some(c => c.includes("client_name")));
});

test("buildAfterHoursMartConditions: exclude=['tecnico'] NUNCA elimina from/to - autoexclusión solo omite la dimensión propia (ETAPA 6.6D-FIX-1)", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ technician: "T1", from: "2026-08-01", to: "2026-08-31" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher, ["tecnico"]);
  assert.ok(!conditions.some(c => c.includes("assigned_to")));
  assert.ok(conditions.some(c => c.includes("start_time_local") && c.includes(">=")));
  assert.ok(conditions.some(c => c.includes("start_time_local") && c.includes("<=")));
});

test("buildAfterHoursMartConditions: exclude=['cliente'] NUNCA elimina from/to - autoexclusión solo omite la dimensión propia (ETAPA 6.6D-FIX-1)", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(qs({ client: "C1", from: "2026-08-01", to: "2026-08-31" }));
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher, ["cliente"]);
  assert.ok(!conditions.some(c => c.includes("client_name")));
  assert.ok(conditions.some(c => c.includes("start_time_local") && c.includes(">=")));
  assert.ok(conditions.some(c => c.includes("start_time_local") && c.includes("<=")));
});

test("buildAfterHoursMartConditions: múltiples filtros simultáneos -> placeholders 1:1 con params, en orden, sin huecos ni duplicados", () => {
  const pusher = createParamPusher();
  const filters = parseAfterHoursFilters(
    qs({ client: "C1", technician: "T1", taskType: "PM", from: "2026-01-01", to: "2026-01-31", weekday: "3", hour: "14", dataBasis: "CONTRACTUAL" })
  );
  const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
  const usedPlaceholders = conditions.flatMap(c => [...c.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
  const expected = Array.from({ length: pusher.params.length }, (_, i) => i + 1);
  assert.deepEqual([...usedPlaceholders].sort((a, b) => a - b), expected, "cada placeholder $N debe usarse exactamente una vez, sin huecos ni duplicados");
  assert.equal(new Set(usedPlaceholders).size, usedPlaceholders.length, "ningún placeholder se reutiliza para dos valores distintos");
});
