import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRowModel, isAfterHoursRowSelected, buildAfterHoursDrawerContext } from "../../lib/after-hours-detail-view.ts";
import type { AfterHoursDetailRow } from "../../types/after-hours.ts";

// Sección 14.2 del encargo NEXUS V3 After-Hours - resolveRowModel traduce
// el arreglo resolved_models (ya DISTINCT/sin nulls, ver app/api/dashboard/
// after-hours/detail/route.ts) a {model, model_resolution_status}.
test("resolveRowModel: sin modelos resueltos -> UNKNOWN, nunca '-'/'N/A'/null/''", () => {
  assert.deepEqual(resolveRowModel(null), { model: null, model_resolution_status: "UNKNOWN" });
  assert.deepEqual(resolveRowModel([]), { model: null, model_resolution_status: "UNKNOWN" });
});

test("resolveRowModel: 1 modelo resuelto -> RESOLVED con ese valor exacto", () => {
  assert.deepEqual(resolveRowModel(["VersaHD"]), { model: "VersaHD", model_resolution_status: "RESOLVED" });
});

test("resolveRowModel: 2+ modelos distintos (tarea multi-equipo) -> ambos listados unidos con ' / ', nunca se elige uno", () => {
  const result = resolveRowModel(["Platform", "VersaHD"]);
  assert.equal(result.model, "Platform / VersaHD");
  assert.equal(result.model_resolution_status, "RESOLVED");
});

// Sección 14.4 del encargo - selección visual de fila.
test("isAfterHoursRowSelected: mismo id -> true, id distinto -> false, nada seleccionado -> false", () => {
  assert.equal(isAfterHoursRowSelected(101, 101), true);
  assert.equal(isAfterHoursRowSelected(101, 202), false);
  assert.equal(isAfterHoursRowSelected(101, null), false);
});

function baseRow(overrides: Partial<AfterHoursDetailRow> = {}): AfterHoursDetailRow {
  return {
    fieldbeat_task_id: 500001,
    analysis_start_time: "2026-03-10 22:00:00",
    analysis_end_time: "2026-03-11 00:30:00",
    analysis_interval_basis: "REPORTED_WORK_INTERVAL",
    analysis_fallback_used: false,
    analysis_fallback_reason: null,
    reported_end_raw: null,
    calculation_method: "NORMALIZED_INTERVAL",
    client_name: "ACME",
    equipment_internal_ids: "LINAC-1",
    assigned_to: "jperez",
    task_type: "CORRECTIVA",
    duration_hours: 2.5,
    business_hours: 0.5,
    after_hours: 1.5,
    weekend_hours: 0.5,
    holiday_hours: 0,
    after_hours_rate: 0.8,
    calculation_status: "CALCULATED",
    confidence_score: 87,
    confidence_label: "Alta",
    confidence_factors: null,
    participant_count: 1,
    model: "VersaHD",
    model_resolution_status: "RESOLVED",
    data_basis: "CONTRACTUAL",
    fallback_used: false,
    coverage_classification: "PARTIALLY_COVERED",
    coverage_reason_code: "WITHIN_MATCHED_CONTRACT",
    contractual_attempt_status: null,
    contractual_coverage_classification: null,
    contractual_reason_code: null,
    contract_resolution_confidence: 92,
    contract_resolution_label: "Alta",
    confidence_model_version: "v1",
    primary_equipment_key: "EQ-1",
    ...overrides
  };
}

// Sección 14.5.D del encargo - corrección de rótulo: antes decía "Minutos
// cubiertos"/"Minutos fuera de cobertura" para un valor formateado en
// horas (bug real, mezcla de unidad y etiqueta). buildAfterHoursDrawerContext
// ya no produce esas cadenas - las etiquetas correctas ("Tiempo cubierto"/
// "Tiempo fuera de cobertura") viven en el JSX de FieldbeatReportDetailContent.tsx,
// esta prueba confirma que el VALOR sigue siendo un formato de horas válido
// (nunca "NaN h"/vacío) para que ese rótulo sea semánticamente correcto.
test("buildAfterHoursDrawerContext: coveredTimeLabel/uncoveredTimeLabel son horas formateadas, nunca minutos crudos ni NaN", () => {
  const ctx = buildAfterHoursDrawerContext(baseRow());
  assert.match(ctx.coveredTimeLabel, /^\d+([,.]\d)? h$/, `coveredTimeLabel debe ser un formato "X,X h": "${ctx.coveredTimeLabel}"`);
  assert.match(ctx.uncoveredTimeLabel, /^\d+([,.]\d)? h$/, `uncoveredTimeLabel debe ser un formato "X,X h": "${ctx.uncoveredTimeLabel}"`);
  assert.doesNotMatch(ctx.coveredTimeLabel, /min/i);
  assert.doesNotMatch(ctx.uncoveredTimeLabel, /min/i);
});

test("buildAfterHoursDrawerContext: expone intervalo multi-día con base y fallback explícitos", () => {
  const ctx = buildAfterHoursDrawerContext(baseRow());
  assert.equal(ctx.analysisStartLabel, "2026-03-10 22:00");
  assert.equal(ctx.analysisEndLabel, "2026-03-11 00:30");
  assert.equal(ctx.analysisIntervalBasisLabel, "Ejecución informada en formulario FieldBeat");
  assert.equal(ctx.analysisFallbackUsed, false);
  assert.equal(ctx.analysisFallbackReason, null);
});

test("buildAfterHoursDrawerContext: business_hours=null (data_basis=NONE) nunca muestra '0 h', muestra '—'", () => {
  const ctx = buildAfterHoursDrawerContext(baseRow({ business_hours: null, data_basis: "NONE" }));
  assert.equal(ctx.coveredTimeLabel, "—");
});

test("buildAfterHoursDrawerContext: confianza temporal y contractual quedan DIFERENCIADAS, nunca bajo una sola etiqueta genérica", () => {
  const ctx = buildAfterHoursDrawerContext(baseRow());
  assert.match(ctx.temporalConfidenceText, /87/);
  assert.ok(ctx.contractualConfidenceText, "data_basis=CONTRACTUAL debe exponer confianza contractual aparte");
  assert.match(ctx.contractualConfidenceText!, /92/);
  assert.notEqual(ctx.temporalConfidenceText, ctx.contractualConfidenceText);
});

test("buildAfterHoursDrawerContext: data_basis distinto de CONTRACTUAL nunca inventa una confianza contractual", () => {
  const ctx = buildAfterHoursDrawerContext(baseRow({ data_basis: "LEGACY_SCHEDULE" }));
  assert.equal(ctx.contractualConfidenceText, null);
});

// Sección 14.3 del encargo - identidad de fila: fieldbeat_task_id (número,
// siempre presente, nunca undefined) es la MISMA identidad usada como React
// key, selección y navegación al drawer - esta prueba confirma que un
// conjunto de filas fixture produce keys no vacías y únicas.
test("identidad de fila: fieldbeat_task_id produce claves no vacías y únicas para un conjunto de filas", () => {
  const rows = [baseRow({ fieldbeat_task_id: 1 }), baseRow({ fieldbeat_task_id: 2 }), baseRow({ fieldbeat_task_id: 3 })];
  const keys = rows.map(r => String(r.fieldbeat_task_id));
  assert.ok(keys.every(k => k.length > 0));
  assert.equal(new Set(keys).size, keys.length, "las claves deben ser únicas, nunca repetidas ni colapsadas");
});
