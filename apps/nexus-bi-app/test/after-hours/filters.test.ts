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
