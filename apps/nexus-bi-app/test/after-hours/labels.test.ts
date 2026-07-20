import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDiagnosis,
  getCalculationStatusLabel,
  getConfidenceTierLabel,
  getCoverageClassificationLabel,
  getDataBasisLabel,
  getFallbackLabel,
  getReasonCodeLabel,
  getWeekdayLabel,
  getWeekdayShortLabel,
  WEEKDAY_ORDER
} from "../../lib/after-hours-labels.ts";

// === día de la semana (ETAPA 6.6D) ===

test("WEEKDAY_ORDER es exactamente [1..7] (ISODOW, lunes primero)", () => {
  assert.deepEqual(WEEKDAY_ORDER, [1, 2, 3, 4, 5, 6, 7]);
});

test("getWeekdayLabel: 1..7 mapean a Lunes..Domingo", () => {
  assert.equal(getWeekdayLabel(1), "Lunes");
  assert.equal(getWeekdayLabel(2), "Martes");
  assert.equal(getWeekdayLabel(3), "Miércoles");
  assert.equal(getWeekdayLabel(4), "Jueves");
  assert.equal(getWeekdayLabel(5), "Viernes");
  assert.equal(getWeekdayLabel(6), "Sábado");
  assert.equal(getWeekdayLabel(7), "Domingo");
});

test("getWeekdayLabel: acepta string numérico (viene de row.key como texto)", () => {
  assert.equal(getWeekdayLabel("3"), "Miércoles");
});

test("getWeekdayLabel: degrada de forma segura en 0, 8, null, undefined y no-numérico", () => {
  assert.equal(getWeekdayLabel(0), "Sin día");
  assert.equal(getWeekdayLabel(8), "Sin día");
  assert.equal(getWeekdayLabel(null), "Sin día");
  assert.equal(getWeekdayLabel(undefined), "Sin día");
  assert.equal(getWeekdayLabel("abc"), "Sin día");
});

test("getWeekdayShortLabel: 1..7 mapean a Lun..Dom, degrada a N/D", () => {
  assert.equal(getWeekdayShortLabel(1), "Lun");
  assert.equal(getWeekdayShortLabel(7), "Dom");
  assert.equal(getWeekdayShortLabel(null), "N/D");
});

// === data_basis (§14) ===

test("getDataBasisLabel: CONTRACTUAL/LEGACY_SCHEDULE/NONE tienen label+severity distintos", () => {
  assert.equal(getDataBasisLabel("CONTRACTUAL").severity, "success");
  assert.equal(getDataBasisLabel("LEGACY_SCHEDULE").severity, "info");
  assert.equal(getDataBasisLabel("NONE").severity, "neutral");
});

test("getDataBasisLabel: código desconocido degrada a UNKNOWN_LABEL, nunca lanza", () => {
  const result = getDataBasisLabel("ALGO_INVENTADO");
  assert.equal(result.label, "Sin clasificar");
  assert.equal(result.severity, "neutral");
});

test("getDataBasisLabel: null/undefined degradan igual que un código desconocido", () => {
  assert.equal(getDataBasisLabel(null).label, "Sin clasificar");
  assert.equal(getDataBasisLabel(undefined).label, "Sin clasificar");
});

// === coverage_classification ===

test("getCoverageClassificationLabel: las 4 clasificaciones tienen severidad coherente con su semántica", () => {
  assert.equal(getCoverageClassificationLabel("FULLY_COVERED").severity, "success");
  assert.equal(getCoverageClassificationLabel("PARTIALLY_COVERED").severity, "warning");
  assert.equal(getCoverageClassificationLabel("NOT_COVERED").severity, "danger");
  assert.equal(getCoverageClassificationLabel("NOT_CALCULABLE").severity, "neutral");
});

// === reason codes (compartido entre coverage_reason_code y contractual_reason_code) ===

test("getReasonCodeLabel: los 17 códigos del vocabulario cerrado resuelven a una etiqueta real (no UNKNOWN)", () => {
  const codes = [
    "WITHIN_MATCHED_CONTRACT",
    "WITHIN_LEGACY_SCHEDULE",
    "MULTIPLE_EQUIPMENT_SAME_COVERAGE",
    "MULTIPLE_EQUIPMENT_CONFLICT",
    "NO_EQUIPMENT",
    "EQUIPMENT_UNMATCHED",
    "EQUIPMENT_AMBIGUOUS",
    "NO_CONTRACT_AT_TASK_DATE",
    "NO_CONTRACT_STATUS",
    "ON_DEMAND_UNDEFINED",
    "CONTRACT_STATUS_DEINSTALLED",
    "SCHEDULE_REVIEW_REQUIRED",
    "CRITICALITY_UNKNOWN",
    "HOLIDAY_COVERAGE_UNKNOWN",
    "INVALID_START_TIME",
    "INVALID_DURATION",
    "INSUFFICIENT_DATA"
  ];
  for (const code of codes) {
    const label = getReasonCodeLabel(code);
    assert.notEqual(label.label, "Sin clasificar", `código ${code} no debería degradar a UNKNOWN`);
  }
});

test("getReasonCodeLabel: código fuera del vocabulario degrada de forma segura", () => {
  assert.equal(getReasonCodeLabel("CODIGO_FUTURO_NO_CONTEMPLADO").label, "Sin clasificar");
});

// === calculation_status ===

test("getCalculationStatusLabel: CALCULATED_WITH_WARNINGS tiene severidad warning, distinta de CALCULATED", () => {
  assert.equal(getCalculationStatusLabel("CALCULATED").severity, "success");
  assert.equal(getCalculationStatusLabel("CALCULATED_WITH_WARNINGS").severity, "warning");
  assert.equal(getCalculationStatusLabel("NOT_CALCULABLE").severity, "neutral");
});

// === fallback_used ===

test("getFallbackLabel: true/false/null son 3 resultados distintos, ninguno lanza", () => {
  assert.equal(getFallbackLabel(true).shortLabel, "Con fallback");
  assert.equal(getFallbackLabel(false).shortLabel, "Sin fallback");
  assert.equal(getFallbackLabel(null).label, "Sin clasificar");
  assert.equal(getFallbackLabel(undefined).label, "Sin clasificar");
});

// === confidence tier (temporal) - null nunca es "Insuficiente" ===

test("getConfidenceTierLabel: null/undefined -> 'Sin información', NUNCA 'Insuficiente' (ETAPA 6.6D §10)", () => {
  assert.equal(getConfidenceTierLabel(null).label, "Sin información");
  assert.equal(getConfidenceTierLabel(undefined).label, "Sin información");
  assert.equal(getConfidenceTierLabel(null).severity, "neutral");
});

test("getConfidenceTierLabel: 'Insuficiente' es un tier real, distinto de 'Sin información'", () => {
  const tier = getConfidenceTierLabel("Insuficiente");
  assert.equal(tier.label, "Insuficiente");
  assert.equal(tier.severity, "danger");
  assert.notEqual(tier.label, getConfidenceTierLabel(null).label);
});

test("getConfidenceTierLabel: Alta/Media/Baja resuelven con severidad semántica ascendente en riesgo", () => {
  assert.equal(getConfidenceTierLabel("Alta").severity, "success");
  assert.equal(getConfidenceTierLabel("Media").severity, "info");
  assert.equal(getConfidenceTierLabel("Baja").severity, "warning");
});

// === buildDiagnosis (§11) ===

test("buildDiagnosis: data_basis=NONE muestra el coverage_reason_code directo como primary, sin secondary", () => {
  const d = buildDiagnosis({ dataBasis: "NONE", fallbackUsed: false, coverageReasonCode: "INVALID_START_TIME", contractualReasonCode: null });
  assert.equal(d.primary.label, getReasonCodeLabel("INVALID_START_TIME").label);
  assert.equal(d.secondary, null);
});

test("buildDiagnosis: CONTRACTUAL sin fallback muestra solo el data_basis como primary, sin secondary", () => {
  const d = buildDiagnosis({ dataBasis: "CONTRACTUAL", fallbackUsed: false, coverageReasonCode: "WITHIN_MATCHED_CONTRACT", contractualReasonCode: "WITHIN_MATCHED_CONTRACT" });
  assert.equal(d.primary.label, getDataBasisLabel("CONTRACTUAL").label);
  assert.equal(d.secondary, null);
});

test("buildDiagnosis: LEGACY_SCHEDULE con fallback_used=true agrega el motivo contractual como secondary", () => {
  const d = buildDiagnosis({ dataBasis: "LEGACY_SCHEDULE", fallbackUsed: true, coverageReasonCode: "WITHIN_LEGACY_SCHEDULE", contractualReasonCode: "EQUIPMENT_UNMATCHED" });
  assert.equal(d.primary.label, getDataBasisLabel("LEGACY_SCHEDULE").label);
  assert.ok(d.secondary?.includes("equipo sin identificar"), `secondary inesperado: ${d.secondary}`);
});

test("buildDiagnosis: primary nunca expone un código técnico crudo como texto (siempre pasa por getXLabel)", () => {
  const d = buildDiagnosis({ dataBasis: "NONE", fallbackUsed: false, coverageReasonCode: "HOLIDAY_COVERAGE_UNKNOWN", contractualReasonCode: null });
  assert.notEqual(d.primary.label, "HOLIDAY_COVERAGE_UNKNOWN");
});
