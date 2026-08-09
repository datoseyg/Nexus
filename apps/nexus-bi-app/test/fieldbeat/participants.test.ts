// HOTFIX de integridad de datos FieldBeat (post-Phase 6) - pruebas unitarias
// (sin DB) de lib/fieldbeat-participants.ts: shapeParticipant() (fila cruda
// de quality.fieldbeat_report_participants -> FieldbeatParticipant) y
// shapeLaborSummary() (fila cruda de quality.fieldbeat_report_labor_summary
// -> FieldbeatLaborSummary). Fixture de regresión: reporte 3453 (Manuel
// Reyes principal, Alexis Acevedo adicional vía "OTROS (COMENTE)").
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeParticipant, shapeLaborSummary, sortParticipants, type RawParticipantRow, type RawLaborSummaryRow } from "../../lib/fieldbeat-participants.ts";

function participantRow(overrides: Partial<RawParticipantRow> = {}): RawParticipantRow {
  return {
    fieldbeat_task_id: "3453",
    raw_name: "mreyes",
    normalized_name: "MANUEL REYES",
    role: "PRIMARY_ASSIGNEE",
    source_field: "assigned_to",
    resolution_status: "RESOLVED_ASSIGNED_TO",
    is_primary: true,
    ...overrides
  };
}

test("shapeParticipant: responsable principal (Manuel Reyes) se mapea 1:1, isPrimary=true", () => {
  const p = shapeParticipant(participantRow());
  assert.equal(p.rawName, "mreyes");
  assert.equal(p.normalizedName, "MANUEL REYES");
  assert.equal(p.role, "PRIMARY_ASSIGNEE");
  assert.equal(p.isPrimary, true);
  assert.equal(p.resolutionStatus, "RESOLVED_ASSIGNED_TO");
});

test("shapeParticipant: adicional de texto libre no resoluble (Alexis Acevedo) se conserva, nunca se descarta", () => {
  const p = shapeParticipant(
    participantRow({
      raw_name: "Alexis Acevedo",
      normalized_name: "ALEXIS ACEVEDO",
      role: "ADDITIONAL_FREE_TEXT",
      source_field: "NOMBRE DEL INGENIERO ADICIONAL",
      resolution_status: "UNRESOLVED_FREE_TEXT",
      is_primary: false
    })
  );
  assert.equal(p.rawName, "Alexis Acevedo");
  assert.equal(p.role, "ADDITIONAL_FREE_TEXT");
  assert.equal(p.resolutionStatus, "UNRESOLVED_FREE_TEXT");
  assert.equal(p.isPrimary, false);
});

test("sortParticipants: responsable principal SIEMPRE primero, luego estructurados, luego texto libre, luego no resueltos", () => {
  const unresolved = participantRow({ raw_name: "Token Desconocido", role: "UNRESOLVED_ADDITIONAL", resolution_status: "UNRESOLVED_UNKNOWN_TOKEN", is_primary: false });
  const freeText = participantRow({ raw_name: "Alexis Acevedo", role: "ADDITIONAL_FREE_TEXT", resolution_status: "UNRESOLVED_FREE_TEXT", is_primary: false });
  const structured = participantRow({ raw_name: "JOSE ECHEVERRIA", role: "ADDITIONAL_STRUCTURED", resolution_status: "RESOLVED_ROSTER_MATCH", is_primary: false });
  const primary = participantRow();

  const sorted = sortParticipants([unresolved, freeText, structured, primary].map(shapeParticipant));
  assert.deepEqual(
    sorted.map(p => p.role),
    ["PRIMARY_ASSIGNEE", "ADDITIONAL_STRUCTURED", "ADDITIONAL_FREE_TEXT", "UNRESOLVED_ADDITIONAL"]
  );
});

function laborRow(overrides: Partial<RawLaborSummaryRow> = {}): RawLaborSummaryRow {
  return {
    fieldbeat_task_id: "3453",
    actual_report_duration_minutes: 130,
    actual_duration_source: "FORM_DECLARED_INTERVAL",
    scheduled_estimate_minutes: 120,
    participant_count: 2,
    total_labor_minutes: 260,
    individual_time_available: false,
    ...overrides
  };
}

test("shapeLaborSummary: caso 3453 - 130 min reales (declarados), 120 estimado, 260 minutos-persona, ambos visibles simultáneamente", () => {
  const labor = shapeLaborSummary(laborRow());
  assert.equal(labor.actualReportDurationMinutes, 130);
  assert.equal(labor.actualDurationSource, "FORM_DECLARED_INTERVAL");
  assert.equal(labor.scheduledEstimateMinutes, 120, "la estimación de agenda se conserva por separado, nunca se descarta ni se confunde con la real");
  assert.equal(labor.participantCount, 2);
  assert.equal(labor.totalLaborMinutes, 260);
  assert.equal(labor.individualTimeAvailable, false);
});

test("shapeLaborSummary: sin duración real disponible -> null, NUNCA se rellena con la estimación de agenda", () => {
  const labor = shapeLaborSummary(laborRow({ actual_report_duration_minutes: null, actual_duration_source: "UNAVAILABLE", total_labor_minutes: null }));
  assert.equal(labor.actualReportDurationMinutes, null);
  assert.equal(labor.actualDurationSource, "UNAVAILABLE");
  assert.equal(labor.totalLaborMinutes, null, "ausencia de duración real produce null, nunca una estimación disfrazada de dato real");
});

test("shapeLaborSummary: coerciona valores numéricos de string (driver pg) a number", () => {
  const labor = shapeLaborSummary(
    laborRow({
      actual_report_duration_minutes: "130" as unknown as number,
      scheduled_estimate_minutes: "120" as unknown as number,
      participant_count: "2" as unknown as number,
      total_labor_minutes: "260" as unknown as number
    })
  );
  assert.equal(labor.actualReportDurationMinutes, 130);
  assert.equal(labor.scheduledEstimateMinutes, 120);
  assert.equal(labor.participantCount, 2);
  assert.equal(labor.totalLaborMinutes, 260);
});
