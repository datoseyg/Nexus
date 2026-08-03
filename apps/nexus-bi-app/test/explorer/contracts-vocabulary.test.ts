import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractStatusLabel,
  spaTierLabel,
  contractMatchStatusLabel,
  preventiveMaintenanceLabel,
  resolveContractCoverageState
} from "../../lib/contracts-vocabulary.ts";
import type { ContractCoverageSchedule, ContractScheduleResult } from "../../types/contracts.ts";

// Sección 12/15 de la corrección de identidad de Equipos - los códigos
// técnicos NUNCA dominan la UI: cada código real (confirmado contra el CHECK
// de sql/070_config.sql) tiene una etiqueta de negocio, y un código no
// mapeado devuelve el crudo tal cual (señal de vocabulario desactualizado,
// nunca una traducción inventada).
test("contractStatusLabel traduce el catálogo real completo, nunca el código crudo", () => {
  assert.equal(contractStatusLabel("ACTIVE_AUTO_RENEW"), "Activo con renovación automática");
  assert.equal(contractStatusLabel("ACTIVE_FIXED_TERM"), "Activo con plazo fijo");
  assert.equal(contractStatusLabel("DEINSTALLED"), "Equipo desinstalado");
  assert.equal(contractStatusLabel("DIRECT_WITH_ELEKTA"), "Contrato directo con Elekta");
  assert.equal(contractStatusLabel("ON_DEMAND"), "Servicio bajo demanda");
  assert.equal(contractStatusLabel("WARRANTY_ELEKTA"), "Garantía Elekta");
  assert.equal(contractStatusLabel("UNKNOWN"), "No informado");
  assert.notEqual(contractStatusLabel("ACTIVE_AUTO_RENEW"), "ACTIVE_AUTO_RENEW");
});

test("contractStatusLabel nunca inventa una traducción para un código no mapeado", () => {
  assert.equal(contractStatusLabel("SOME_FUTURE_CODE"), "SOME_FUTURE_CODE");
});

test("contractStatusLabel/spaTierLabel nunca lanzan con null/undefined/vacío - siempre 'No informado'", () => {
  assert.equal(contractStatusLabel(null), "No informado");
  assert.equal(contractStatusLabel(undefined), "No informado");
  assert.equal(contractStatusLabel(""), "No informado");
  assert.equal(spaTierLabel(null), "No informado");
});

// match_status: la UI NUNCA muestra MATCHED/UNMATCHED/AMBIGUOUS como etiqueta
// principal (sección 10) - siempre en lenguaje de negocio.
test("contractMatchStatusLabel usa lenguaje de negocio, nunca el código técnico", () => {
  assert.equal(contractMatchStatusLabel("MATCHED"), "Vinculado con FieldBeat");
  assert.equal(contractMatchStatusLabel("UNMATCHED"), "Sin vincular");
  assert.equal(contractMatchStatusLabel("AMBIGUOUS"), "Vinculación por confirmar");
  for (const code of ["MATCHED", "UNMATCHED", "AMBIGUOUS"]) {
    assert.notEqual(contractMatchStatusLabel(code), code);
  }
});

// preventiveMaintenanceLabel es la ÚNICA cifra contractual real con
// unidad/periodo propios (no existe un campo de "horas contractuales" en la
// fuente, ver lib/contracts-vocabulary.ts) - NUNCA debe mostrar un número
// desnudo sin su unidad ("/ año"), y una regla textual real (ej. "Por cada
// cambio de fuente") se conserva tal cual, nunca se descarta.
test("preventiveMaintenanceLabel siempre incluye la unidad/periodo, nunca un número desnudo", () => {
  assert.equal(preventiveMaintenanceLabel(2, 2, null), "2 mantenimientos preventivos / año");
  assert.equal(preventiveMaintenanceLabel(1, 1, null), "1 mantenimiento preventivo / año");
  assert.equal(preventiveMaintenanceLabel(2, 4, null), "2-4 mantenimientos preventivos / año");
  assert.match(preventiveMaintenanceLabel(2, 2, null), /año/);
});

test("preventiveMaintenanceLabel conserva una regla textual real tal cual, nunca la descarta", () => {
  assert.equal(preventiveMaintenanceLabel(null, null, "Por cada cambio de fuente"), "Por cada cambio de fuente");
});

test("preventiveMaintenanceLabel sin datos devuelve 'No informado', nunca 0 ni un valor fabricado", () => {
  assert.equal(preventiveMaintenanceLabel(null, null, null), "No informado");
});

// Bloque 2 NEXUS V3 - resolveContractCoverageState(): cada estado de
// cobertura contractual debe ser distinguible, nunca colapsado en un
// genérico "Horario no informado".
function baseSchedule(overrides: Partial<ContractCoverageSchedule>): ContractCoverageSchedule {
  return {
    timezone: "America/Santiago",
    coverageType: "FULL_24X7",
    parseStatus: "OK",
    windows: [],
    coversWeekends: true,
    coversHolidays: true,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    resolutionSource: "config.contract_service_schedules",
    ...overrides
  };
}
function available(overrides: Partial<ContractCoverageSchedule>): ContractScheduleResult {
  return { status: "AVAILABLE", schedule: baseSchedule(overrides) };
}

test("resolveContractCoverageState: UNAVAILABLE -> mensaje de 'no se pudo verificar', nunca confundido con MISSING", () => {
  const state = resolveContractCoverageState({ status: "UNAVAILABLE", schedule: null });
  assert.equal(state.kind, "UNAVAILABLE");
  assert.match(state.message, /no fue posible verificar/i);
});

test("resolveContractCoverageState: MISSING -> 'no existe configuración', nunca dice 'ventana' (un FULL_24X7 válido puede no tener ninguna)", () => {
  const state = resolveContractCoverageState({ status: "MISSING", schedule: null });
  assert.equal(state.kind, "MISSING");
  assert.doesNotMatch(state.message, /ventana/i);
});

test("resolveContractCoverageState: FULL_24X7 sin ventanas -> Cobertura 24/7, nunca 'sin horario' (caso esperado, no una inconsistencia)", () => {
  const state = resolveContractCoverageState(available({ coverageType: "FULL_24X7", windows: [] }));
  assert.equal(state.kind, "TWENTY_FOUR_SEVEN");
  assert.match(state.message, /24\/7/);
});

test("resolveContractCoverageState: CRITICAL_ONLY_24X7 -> estado PROPIO, nunca colapsado en UNKNOWN/no-verificable", () => {
  const state = resolveContractCoverageState(available({ coverageType: "CRITICAL_ONLY_24X7", windows: [] }));
  assert.equal(state.kind, "CRITICAL_ONLY_TWENTY_FOUR_SEVEN");
  assert.match(state.message, /eventos críticos/i);
  assert.notEqual(state.kind, "UNKNOWN");
});

test("resolveContractCoverageState: FIXED_WINDOW con ventanas reales -> EXPLICIT_WINDOWS", () => {
  const state = resolveContractCoverageState(
    available({
      coverageType: "FIXED_WINDOW",
      windows: [{ dayOfWeek: "MON", dayLabel: "Lunes", startTime: "08:00:00", endTime: "17:00:00", allDay: false, includesHolidays: false }]
    })
  );
  assert.equal(state.kind, "EXPLICIT_WINDOWS");
});

test("resolveContractCoverageState: FIXED_WINDOW sin ventanas (inconsistencia de datos) -> mismo tratamiento que 'sin tramo explícito', nunca inventa horas", () => {
  const state = resolveContractCoverageState(available({ coverageType: "FIXED_WINDOW", windows: [] }));
  assert.equal(state.kind, "NO_EXPLICIT_WINDOWS");
});

test("resolveContractCoverageState: BUSINESS_HOURS_UNDEFINED -> 'horario hábil', nunca inventa Lun-Vie 08:30-18:30", () => {
  const state = resolveContractCoverageState(available({ coverageType: "BUSINESS_HOURS_UNDEFINED", windows: [], coversWeekends: null, coversHolidays: null }));
  assert.equal(state.kind, "BUSINESS_HOURS_UNSPECIFIED");
  assert.match(state.message, /horario hábil/i);
  assert.doesNotMatch(state.message, /08:30|18:30/);
});

test("resolveContractCoverageState: ON_DEMAND/NOT_COVERED/NOT_APPLICABLE -> NO_COVERAGE", () => {
  for (const coverageType of ["ON_DEMAND", "NOT_COVERED", "NOT_APPLICABLE"] as const) {
    const state = resolveContractCoverageState(available({ coverageType, windows: [], coversWeekends: null, coversHolidays: null }));
    assert.equal(state.kind, "NO_COVERAGE");
  }
});

test("resolveContractCoverageState: UNKNOWN -> 'no fue posible verificar', igual que UNAVAILABLE en texto pero kind distinto", () => {
  const state = resolveContractCoverageState(available({ coverageType: "UNKNOWN", windows: [], coversWeekends: null, coversHolidays: null }));
  assert.equal(state.kind, "UNKNOWN");
});

test("resolveContractCoverageState: parseStatus REVIEW_REQUIRED es una marca ortogonal, coexiste con cualquier kind", () => {
  const reviewFull247 = resolveContractCoverageState(available({ coverageType: "FULL_24X7", parseStatus: "REVIEW_REQUIRED" }));
  assert.equal(reviewFull247.kind, "TWENTY_FOUR_SEVEN");
  assert.equal(reviewFull247.needsReview, true);

  const okFull247 = resolveContractCoverageState(available({ coverageType: "FULL_24X7", parseStatus: "OK" }));
  assert.equal(okFull247.needsReview, false);
});
