// Detalle maestro de un reporte FieldBeat (Phase 5) - reutiliza EXACTAMENTE
// las mismas vistas quality.* que ya alimentan overview/quality/reports
// (nunca reimplementa una regla de negocio acá). 1 round-trip: el reporte
// es una sola fila de quality.fieldbeat_report_quality, con
// tickets/repuestos/inconsistencias como columnas JSON vía subqueries
// correlacionadas (mismo idioma que buildReportsFilteredCte en
// fieldbeat-reports-queries.ts) - nunca un JOIN plano que multiplique
// equipos × tickets × repuestos.
import { INCONSISTENCY_TAXONOMY, type InconsistencyCode, type InconsistencySeverity } from "./fieldbeat-inconsistency-taxonomy";
import { deriveEquipmentItems } from "./fieldbeat-equipment-derivation";
import { shapePartOccurrence, type RawPartOccurrenceRow } from "./fieldbeat-part-occurrence";
import { shapeLaborSummary, shapeParticipant, sortParticipants, type RawLaborSummaryRow, type RawParticipantRow } from "./fieldbeat-participants";
import {
  FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION,
  type FieldbeatInconsistencyDetail,
  type FieldbeatReportDetail,
  type FieldbeatTicketLink
} from "@/types/fieldbeat-report-detail";

const ID_PATTERN = /^[1-9]\d*$/;

/**
 * Entero positivo, sin ceros a la izquierda, sin decimales, sin notación
 * científica, sin signo - fieldbeat_task_id es BIGINT (nunca 0 en datos
 * reales, arranca en la centena). Lanza Error (handleApiError lo mapea a
 * 400) en cualquier otro caso - nunca coerciona con Number()/parseInt().
 */
export function parseFieldbeatTaskId(raw: string): string {
  if (!ID_PATTERN.test(raw)) {
    throw new Error(`ID de reporte inválido: "${raw}" (se espera un entero positivo)`);
  }
  return raw;
}

export interface ReportDetailQueryResult {
  sql: string;
  params: unknown[];
}

export function buildReportDetailQuery(fieldbeatTaskId: string): ReportDetailQueryResult {
  const sql = `
    SELECT
      q.fieldbeat_task_id,
      q.state,
      q.is_closed,
      q.is_finished,
      q.task_type,
      q.origen,
      q.client_key,
      q.client_name,
      q.report_quality_status,
      q.fieldbeat_task_date,
      q.created_at,
      q.start_time,
      q.last_transition_at,
      q.duration_minutes,
      q.chronology_impossible,
      q.has_sufficient_timestamps,
      q.finished_zero_duration,
      q.finished_null_duration,
      q.technician_names,
      q.has_technician,
      q.has_client,
      q.team_identification_status,
      q.equipment_internal_ids,
      ti.matched_candidate_ids,
      q.structurally_complete,
      q.minimum_fields_complete,
      q.part_fully_traceable,
      q.part_total_lines,
      q.ticket_accessible,
      q.ticket_missing_or_restricted,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'zendesk_ticket_id', b.zendesk_ticket_id::text,
          'subject', zt.subject,
          'status', zt.status,
          'priority', zt.priority,
          'link_method', b.link_method
        ) ORDER BY b.zendesk_ticket_id), '[]'::json)
        FROM marts.ticket_fieldbeat_report_detail b
        LEFT JOIN processed.zendesk_tickets zt ON zt.zendesk_ticket_id = b.zendesk_ticket_id
        WHERE b.fieldbeat_task_id = q.fieldbeat_task_id
      ) AS tickets,
      (
        -- HOTFIX de integridad de datos FieldBeat (§ contrato 2.0.0) - fuente
        -- ÚNICA compartida por FieldBeat/Búsqueda/PDF/CSV (sql/088), nunca
        -- reimplementa acá la lógica de correspondencia de catálogo.
        SELECT COALESCE(json_agg(json_build_object(
          'used_part_id', o.used_part_id,
          'fieldbeat_task_id', o.fieldbeat_task_id::text,
          'part_name', o.part_name,
          'raw_part_identifier', o.raw_part_identifier,
          'normalized_part_identifier', o.normalized_part_identifier,
          'quantity', o.quantity,
          'origin_location', o.origin_location,
          'origin_comment', o.origin_comment,
          'photo_ref', o.photo_ref,
          'declaration_status', o.declaration_status,
          'catalog_match_status', o.catalog_match_status,
          'matched_product_id', o.matched_product_id::text,
          'matched_sku', o.matched_sku,
          'matched_label', o.matched_label,
          'matched_barcode', o.matched_barcode::text,
          'candidate_dolibarr_product_ids', o.candidate_dolibarr_product_ids,
          'match_method', o.match_method,
          'alias_value', o.alias_value,
          'alias_reason', o.alias_reason,
          'alias_created_by', o.alias_created_by
        ) ORDER BY o.used_part_id), '[]'::json)
        FROM quality.fieldbeat_report_part_occurrences o
        WHERE o.fieldbeat_task_id = q.fieldbeat_task_id
      ) AS parts,
      (
        -- Participantes 0..N (HOTFIX de integridad, sql/088) - responsable
        -- principal SIEMPRE incluido (is_primary=true), nunca duplicado como
        -- adicional; un participante no resoluble nunca se descarta.
        SELECT COALESCE(json_agg(json_build_object(
          'fieldbeat_task_id', pt.fieldbeat_task_id::text,
          'raw_name', pt.raw_name,
          'normalized_name', pt.normalized_name,
          'role', pt.role,
          'source_field', pt.source_field,
          'resolution_status', pt.resolution_status,
          'is_primary', pt.is_primary
        )), '[]'::json)
        FROM quality.fieldbeat_report_participants pt
        WHERE pt.fieldbeat_task_id = q.fieldbeat_task_id
      ) AS participants,
      (
        -- Resumen laboral (HOTFIX de integridad, sql/088) - duración real
        -- (declarada o transición validada) SEPARADA de la estimación de
        -- agenda; 1 fila por reporte siempre que exista un responsable
        -- principal (ver primary_assignee en quality.fieldbeat_report_participants).
        SELECT json_build_object(
          'fieldbeat_task_id', ls.fieldbeat_task_id::text,
          'actual_report_duration_minutes', ls.actual_report_duration_minutes,
          'actual_duration_source', ls.actual_duration_source,
          'scheduled_estimate_minutes', ls.scheduled_estimate_minutes,
          'participant_count', ls.participant_count,
          'total_labor_minutes', ls.total_labor_minutes,
          'individual_time_available', ls.individual_time_available
        )
        FROM quality.fieldbeat_report_labor_summary ls
        WHERE ls.fieldbeat_task_id = q.fieldbeat_task_id
      ) AS labor,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'code', ri.code, 'severity', ri.severity, 'priority_order', ri.priority_order
        ) ORDER BY
          CASE ri.severity WHEN 'Alta' THEN 0 WHEN 'Media' THEN 1 WHEN 'Baja' THEN 2 WHEN 'Advertencia' THEN 3 ELSE 4 END,
          ri.priority_order
        ), '[]'::json)
        FROM quality.fieldbeat_report_inconsistencies ri
        WHERE ri.fieldbeat_task_id = q.fieldbeat_task_id
      ) AS inconsistencies,
      (SELECT pi.code FROM quality.fieldbeat_report_primary_inconsistency pi WHERE pi.fieldbeat_task_id = q.fieldbeat_task_id) AS primary_code
    FROM quality.fieldbeat_report_quality q
    LEFT JOIN quality.fieldbeat_team_identification ti ON ti.fieldbeat_task_id = q.fieldbeat_task_id
    WHERE q.fieldbeat_task_id = $1
  `;
  return { sql, params: [fieldbeatTaskId] };
}

interface RawTicketRow {
  zendesk_ticket_id: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  link_method: string | null;
}

interface RawInconsistencyRow {
  code: InconsistencyCode;
  severity: InconsistencySeverity;
  priority_order: number;
}

export interface ReportDetailQueryRow {
  fieldbeat_task_id: string;
  state: string | null;
  is_closed: boolean;
  is_finished: boolean;
  task_type: string | null;
  origen: string | null;
  client_key: string | null;
  client_name: string | null;
  report_quality_status: string | null;
  fieldbeat_task_date: string | null;
  created_at: string | null;
  start_time: string | null;
  last_transition_at: string | null;
  duration_minutes: number | null;
  chronology_impossible: boolean;
  has_sufficient_timestamps: boolean;
  finished_zero_duration: boolean;
  finished_null_duration: boolean;
  technician_names: string | null;
  has_technician: boolean;
  has_client: boolean;
  team_identification_status: import("./fieldbeat-team-identification").TeamIdentificationStatus;
  equipment_internal_ids: string | null;
  matched_candidate_ids: string[] | null;
  structurally_complete: boolean;
  minimum_fields_complete: boolean;
  part_fully_traceable: boolean;
  part_total_lines: number;
  ticket_accessible: boolean | null;
  ticket_missing_or_restricted: boolean;
  tickets: RawTicketRow[];
  parts: RawPartOccurrenceRow[];
  participants: RawParticipantRow[];
  labor: RawLaborSummaryRow | null;
  inconsistencies: RawInconsistencyRow[];
  primary_code: InconsistencyCode | null;
}

function shapeTicket(t: RawTicketRow): FieldbeatTicketLink {
  return { zendeskTicketId: t.zendesk_ticket_id, subject: t.subject, status: t.status, priority: t.priority, linkMethod: t.link_method };
}

function shapeInconsistency(f: RawInconsistencyRow, primaryCode: InconsistencyCode | null): FieldbeatInconsistencyDetail {
  const def = INCONSISTENCY_TAXONOMY.find(d => d.code === f.code);
  return {
    code: f.code,
    severity: f.severity,
    priorityOrder: f.priority_order,
    isPrimary: f.code === primaryCode,
    explanation: def?.explanation ?? "",
    suggestedAction: def?.suggestedAction ?? "",
    universe: def?.universe ?? ""
  };
}

// fieldbeatOpenAvailable viaja como parámetro (nunca como lectura interna
// de process.env acá) - esta función se mantiene pura/determinística dado
// su input; la ruta es quien resuelve isFieldbeatOpenConfigured() y se lo
// pasa (ver app/api/dashboard/fieldbeat/reports/[id]/route.ts).
export function shapeReportDetail(row: ReportDetailQueryRow, fieldbeatOpenAvailable: boolean): FieldbeatReportDetail {
  const equipment = deriveEquipmentItems({
    equipmentInternalIds: row.equipment_internal_ids,
    teamIdentificationStatus: row.team_identification_status,
    matchedCandidateIds: row.matched_candidate_ids
  });

  return {
    contractVersion: FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    report: {
      fieldbeatTaskId: row.fieldbeat_task_id,
      state: row.state,
      isClosed: row.is_closed,
      isFinished: row.is_finished,
      taskType: row.task_type,
      origen: row.origen,
      clientName: row.client_name,
      reportQualityStatus: row.report_quality_status,
      fieldbeatTaskDate: row.fieldbeat_task_date
    },
    chronology: {
      createdAt: row.created_at,
      startTime: row.start_time,
      lastTransitionAt: row.last_transition_at,
      durationMinutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
      chronologyImpossible: row.chronology_impossible,
      hasSufficientTimestamps: row.has_sufficient_timestamps,
      finishedZeroDuration: row.finished_zero_duration,
      finishedNullDuration: row.finished_null_duration
    },
    technician: row.has_technician && row.technician_names ? { name: row.technician_names } : null,
    client: row.has_client && row.client_key && row.client_name ? { clientKey: row.client_key, clientName: row.client_name } : null,
    equipment: { status: row.team_identification_status, items: equipment, rawEquipmentReference: row.equipment_internal_ids },
    tickets: (row.tickets ?? []).map(shapeTicket),
    parts: (row.parts ?? []).map(shapePartOccurrence),
    // Responsable principal SIEMPRE primero (sortParticipants) - nunca
    // depende del orden crudo devuelto por json_agg.
    participants: sortParticipants((row.participants ?? []).map(shapeParticipant)),
    // row.labor solo sería null si el reporte no tiene fila en
    // processed.fieldbeat_tasks (no debería ocurrir - quality.fieldbeat_report_quality
    // ya exige esa fila) - se maneja de forma defensiva, nunca con un crash.
    labor: row.labor
      ? shapeLaborSummary(row.labor)
      : { actualReportDurationMinutes: null, actualDurationSource: "UNAVAILABLE", scheduledEstimateMinutes: null, participantCount: 0, totalLaborMinutes: null, individualTimeAvailable: false },
    quality: {
      structurallyComplete: row.structurally_complete,
      minimumFieldsComplete: row.minimum_fields_complete,
      hasTechnician: row.has_technician,
      hasClient: row.has_client,
      teamIdentificationStatus: row.team_identification_status,
      partFullyTraceable: row.part_fully_traceable,
      partTotalLines: Number(row.part_total_lines),
      hasSufficientTimestamps: row.has_sufficient_timestamps,
      chronologyImpossible: row.chronology_impossible,
      ticketAccessible: row.ticket_accessible,
      ticketMissingOrRestricted: row.ticket_missing_or_restricted,
      totalInconsistencies: (row.inconsistencies ?? []).length
    },
    inconsistencies: (row.inconsistencies ?? []).map(f => shapeInconsistency(f, row.primary_code)),
    audit: {
      contractVersion: FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      fieldbeatOpenAvailable
    }
  };
}
