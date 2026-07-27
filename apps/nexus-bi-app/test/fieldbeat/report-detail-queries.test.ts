import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFieldbeatTaskId, buildReportDetailQuery, shapeReportDetail, type ReportDetailQueryRow } from "../../lib/fieldbeat-report-detail-queries.ts";

test("parseFieldbeatTaskId: acepta enteros positivos simples", () => {
  assert.equal(parseFieldbeatTaskId("1"), "1");
  assert.equal(parseFieldbeatTaskId("900005"), "900005");
});

test("parseFieldbeatTaskId: rechaza 0, negativos, decimales, ceros a la izquierda, notación científica, texto", () => {
  for (const bad of ["0", "-1", "1.5", "01", "900005e1", "abc", "", " 5", "5 ", "0x10", "900005;DROP TABLE x"]) {
    assert.throws(() => parseFieldbeatTaskId(bad), `debería rechazar "${bad}"`);
  }
});

test("buildReportDetailQuery: usa exactamente 1 parámetro parametrizado, nunca interpola el ID", () => {
  const { sql, params } = buildReportDetailQuery("900005");
  assert.deepEqual(params, ["900005"]);
  assert.match(sql, /WHERE q\.fieldbeat_task_id = \$1/);
  assert.doesNotMatch(sql, /900005/, "el ID nunca debe aparecer interpolado literalmente en el SQL");
});

// HOTFIX de integridad de datos FieldBeat (§ contrato 2.0.0) - la query
// ahora lee del origen canónico único (quality.fieldbeat_report_part_occurrences/
// quality.fieldbeat_report_participants/quality.fieldbeat_report_labor_summary,
// sql/088), nunca reimplementa la lógica de correspondencia/participantes acá.
test("buildReportDetailQuery: selecciona de las vistas canónicas quality.fieldbeat_report_part_occurrences/participants/labor_summary", () => {
  const { sql } = buildReportDetailQuery("900005");
  assert.match(sql, /quality\.fieldbeat_report_part_occurrences/);
  assert.match(sql, /quality\.fieldbeat_report_participants/);
  assert.match(sql, /quality\.fieldbeat_report_labor_summary/);
});

function baseRow(overrides: Partial<ReportDetailQueryRow> = {}): ReportDetailQueryRow {
  return {
    fieldbeat_task_id: "900005",
    state: "FINISHED",
    is_closed: true,
    is_finished: true,
    task_type: "PM",
    origen: "APK",
    client_key: "CLIENT|1|ACME",
    client_name: "ACME",
    report_quality_status: "OK",
    fieldbeat_task_date: "2026-03-10",
    created_at: "2026-03-10T13:00:00Z",
    start_time: "2026-03-10T14:00:00Z",
    last_transition_at: "2026-03-10T15:00:00Z",
    duration_minutes: 45,
    chronology_impossible: false,
    has_sufficient_timestamps: true,
    finished_zero_duration: false,
    finished_null_duration: false,
    technician_names: "jperez",
    has_technician: true,
    has_client: true,
    team_identification_status: "STRUCTURED_IDENTIFIED",
    equipment_internal_ids: "EQ-901",
    matched_candidate_ids: null,
    structurally_complete: true,
    minimum_fields_complete: true,
    part_fully_traceable: true,
    part_total_lines: 0,
    ticket_accessible: null,
    ticket_missing_or_restricted: false,
    tickets: [],
    parts: [],
    participants: [
      { fieldbeat_task_id: "900005", raw_name: "jperez", normalized_name: "JPEREZ", role: "PRIMARY_ASSIGNEE", source_field: "assigned_to", resolution_status: "RESOLVED_ASSIGNED_TO", is_primary: true }
    ],
    labor: {
      fieldbeat_task_id: "900005",
      actual_report_duration_minutes: null,
      actual_duration_source: "UNAVAILABLE",
      scheduled_estimate_minutes: 45,
      participant_count: 1,
      total_labor_minutes: null,
      individual_time_available: false
    },
    inconsistencies: [],
    primary_code: null,
    ...overrides
  };
}

test("shapeReportDetail: technician/client son null cuando has_technician/has_client son false, nunca un objeto vacío fantasma", () => {
  const detail = shapeReportDetail(baseRow({ has_technician: false, technician_names: null, has_client: false, client_key: null, client_name: null }), false);
  assert.equal(detail.technician, null);
  assert.equal(detail.client, null);
});

test("shapeReportDetail: equipment usa deriveEquipmentItems (STRUCTURED_IDENTIFIED con 1 equipo)", () => {
  const detail = shapeReportDetail(baseRow(), false);
  assert.equal(detail.equipment.status, "STRUCTURED_IDENTIFIED");
  assert.deepEqual(detail.equipment.items, [{ internalId: "EQ-901", source: "STRUCTURED", confirmed: true }]);
});

test("shapeReportDetail: tickets 0..N pasan sin duplicarse ni colapsarse al primero", () => {
  const detail = shapeReportDetail(
    baseRow({
      tickets: [
        { zendesk_ticket_id: "500010", subject: "Falla equipo", status: "closed", priority: "normal", link_method: "exact" },
        { zendesk_ticket_id: "500011", subject: "Seguimiento", status: "open", priority: "high", link_method: "exact" }
      ]
    }),
    false
  );
  assert.equal(detail.tickets.length, 2);
  assert.equal(detail.tickets[0].zendeskTicketId, "500010");
  assert.equal(detail.tickets[1].zendeskTicketId, "500011");
});

test("shapeReportDetail: repuesto CX1551G/Thyratron - rawPartNumber SIEMPRE visible, catalogMatchStatus NO_MATCH nunca oculta que fue declarado", () => {
  const detail = shapeReportDetail(
    baseRow({
      parts: [
        {
          used_part_id: "900005|1|0|CX1551G",
          fieldbeat_task_id: "900005",
          part_name: "Thyratron",
          raw_part_identifier: "CX1551G",
          normalized_part_identifier: "cx1551g",
          quantity: 1,
          origin_location: "Otros (Comente)",
          origin_comment: "Repuesto proporcionado por el cliente",
          photo_ref: null,
          declaration_status: "DECLARED_IN_REPORT",
          catalog_match_status: "NO_MATCH",
          matched_product_id: null,
          matched_sku: null,
          matched_label: null,
          matched_barcode: null,
          candidate_dolibarr_product_ids: null,
          match_method: null,
          alias_value: null,
          alias_reason: null,
          alias_created_by: null
        }
      ]
    }),
    false
  );
  const part = detail.parts[0];
  assert.equal(part.rawName, "Thyratron");
  assert.equal(part.rawPartNumber, "CX1551G");
  assert.equal(part.declarationStatus, "DECLARED_IN_REPORT");
  assert.equal(part.catalogMatchStatus, "NO_MATCH");
  assert.equal(part.sourceLocation, "Otros (Comente)");
  assert.equal(part.sourceComment, "Repuesto proporcionado por el cliente");
});

test("shapeReportDetail: repuesto AMBIGUOUS_MATCH expone matchEvidence.candidateProductIds, nunca un matchedProductId confirmado", () => {
  const detail = shapeReportDetail(
    baseRow({
      parts: [
        {
          used_part_id: "900005|1|0|X",
          fieldbeat_task_id: "900005",
          part_name: "Repuesto X",
          raw_part_identifier: "X",
          normalized_part_identifier: "x",
          quantity: null,
          origin_location: null,
          origin_comment: null,
          photo_ref: null,
          declaration_status: "DECLARED_IN_REPORT",
          catalog_match_status: "AMBIGUOUS_MATCH",
          matched_product_id: null,
          matched_sku: null,
          matched_label: null,
          matched_barcode: null,
          candidate_dolibarr_product_ids: "10776|10704",
          match_method: null,
          alias_value: null,
          alias_reason: null,
          alias_created_by: null
        }
      ]
    }),
    false
  );
  const part = detail.parts[0];
  assert.equal(part.matchedProductId, null);
  assert.deepEqual(part.matchEvidence, { kind: "AMBIGUOUS_CANDIDATES", candidateProductIds: ["10776", "10704"] });
  assert.equal(part.quantity, null, "cantidad ausente nunca se convierte en 0");
});

test("shapeReportDetail: alias histórico solo se muestra cuando catalogMatchStatus=HISTORICAL_ALIAS_MATCH Y existe fila real de alias", () => {
  const withAlias = shapeReportDetail(
    baseRow({
      parts: [
        {
          used_part_id: "p1",
          fieldbeat_task_id: "900005",
          part_name: "Y",
          raw_part_identifier: "Y",
          normalized_part_identifier: "y",
          quantity: 2,
          origin_location: null,
          origin_comment: null,
          photo_ref: null,
          declaration_status: "DECLARED_IN_REPORT",
          catalog_match_status: "HISTORICAL_ALIAS_MATCH",
          matched_product_id: "999",
          matched_sku: "REF-999",
          matched_label: "Producto Y",
          matched_barcode: null,
          candidate_dolibarr_product_ids: null,
          match_method: null,
          alias_value: "Y-HIST",
          alias_reason: "curado por Fulano",
          alias_created_by: "fulano"
        }
      ]
    }),
    false
  );
  assert.deepEqual(withAlias.parts[0].matchEvidence, { kind: "HISTORICAL_ALIAS", aliasValue: "Y-HIST", reason: "curado por Fulano", createdBy: "fulano" });
  assert.equal(withAlias.parts[0].quantity, 2);

  // Mismo catalog_match_status pero SIN fila de alias real (alias_value null) - nunca se inventa un alias.
  const withoutAliasEvidence = shapeReportDetail(
    baseRow({
      parts: [
        {
          used_part_id: "p2",
          fieldbeat_task_id: "900005",
          part_name: "Z",
          raw_part_identifier: "Z",
          normalized_part_identifier: "z",
          quantity: null,
          origin_location: null,
          origin_comment: null,
          photo_ref: null,
          declaration_status: "DECLARED_IN_REPORT",
          catalog_match_status: "HISTORICAL_ALIAS_MATCH",
          matched_product_id: null,
          matched_sku: null,
          matched_label: null,
          matched_barcode: null,
          candidate_dolibarr_product_ids: null,
          match_method: null,
          alias_value: null,
          alias_reason: null,
          alias_created_by: null
        }
      ]
    }),
    false
  );
  assert.deepEqual(withoutAliasEvidence.parts[0].matchEvidence, { kind: "NONE" });
});

test("shapeReportDetail: participants incluye siempre al responsable principal, ordenado primero", () => {
  const detail = shapeReportDetail(
    baseRow({
      participants: [
        { fieldbeat_task_id: "900005", raw_name: "Alexis Acevedo", normalized_name: "ALEXIS ACEVEDO", role: "ADDITIONAL_FREE_TEXT", source_field: "NOMBRE DEL INGENIERO ADICIONAL", resolution_status: "UNRESOLVED_FREE_TEXT", is_primary: false },
        { fieldbeat_task_id: "900005", raw_name: "mreyes", normalized_name: "MANUEL REYES", role: "PRIMARY_ASSIGNEE", source_field: "assigned_to", resolution_status: "RESOLVED_ASSIGNED_TO", is_primary: true }
      ]
    }),
    false
  );
  assert.equal(detail.participants.length, 2);
  assert.equal(detail.participants[0].role, "PRIMARY_ASSIGNEE", "el responsable principal siempre aparece primero, sin importar el orden crudo de la fila");
  assert.equal(detail.participants[1].rawName, "Alexis Acevedo");
});

test("shapeReportDetail: labor separa actualReportDurationMinutes (real) de scheduledEstimateMinutes (estimado), nunca los mezcla", () => {
  const detail = shapeReportDetail(
    baseRow({
      labor: {
        fieldbeat_task_id: "900005",
        actual_report_duration_minutes: 130,
        actual_duration_source: "FORM_DECLARED_INTERVAL",
        scheduled_estimate_minutes: 120,
        participant_count: 2,
        total_labor_minutes: 260,
        individual_time_available: false
      }
    }),
    false
  );
  assert.equal(detail.labor.actualReportDurationMinutes, 130);
  assert.equal(detail.labor.scheduledEstimateMinutes, 120);
  assert.equal(detail.labor.totalLaborMinutes, 260);
});

test("shapeReportDetail: inconsistencias traen explanation/suggestedAction/universe de la taxonomía TS, isPrimary coincide con primary_code", () => {
  const detail = shapeReportDetail(
    baseRow({
      inconsistencies: [
        { code: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY", severity: "Alta", priority_order: 1 },
        { code: "FINISHED_ZERO_DURATION", severity: "Advertencia", priority_order: 9 }
      ],
      primary_code: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY"
    }),
    false
  );
  assert.equal(detail.inconsistencies.length, 2);
  assert.equal(detail.inconsistencies[0].isPrimary, true);
  assert.equal(detail.inconsistencies[1].isPrimary, false);
  assert.ok(detail.inconsistencies[0].explanation.length > 0);
  assert.ok(detail.inconsistencies[0].suggestedAction.length > 0);
  assert.equal(detail.quality.totalInconsistencies, 2);
});

test("shapeReportDetail: sin inconsistencias, quality.totalInconsistencies=0 y array vacío (nunca null)", () => {
  const detail = shapeReportDetail(baseRow(), false);
  assert.deepEqual(detail.inconsistencies, []);
  assert.equal(detail.quality.totalInconsistencies, 0);
});

test("shapeReportDetail: contractVersion 2.0.0 y generatedAt siempre presentes", () => {
  const detail = shapeReportDetail(baseRow(), false);
  assert.equal(detail.contractVersion, "2.0.0");
  assert.ok(detail.generatedAt);
  assert.equal(detail.audit.contractVersion, detail.contractVersion);
});

test("shapeReportDetail: audit.fieldbeatOpenAvailable refleja EXACTAMENTE el parámetro recibido, nunca una lectura interna de process.env", () => {
  assert.equal(shapeReportDetail(baseRow(), false).audit.fieldbeatOpenAvailable, false);
  assert.equal(shapeReportDetail(baseRow(), true).audit.fieldbeatOpenAvailable, true);
});
