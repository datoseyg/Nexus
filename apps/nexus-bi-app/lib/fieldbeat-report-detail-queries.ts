// Detalle maestro de un reporte FieldBeat (Phase 5) - reutiliza EXACTAMENTE
// las mismas vistas quality.* que ya alimentan overview/quality/reports
// (nunca reimplementa una regla de negocio acá). 1 round-trip: el reporte
// es una sola fila de quality.fieldbeat_report_quality, con
// tickets/repuestos/inconsistencias como columnas JSON vía subqueries
// correlacionadas (mismo idioma que buildReportsFilteredCte en
// fieldbeat-reports-queries.ts) - nunca un JOIN plano que multiplique
// equipos × tickets × repuestos.
import { INCONSISTENCY_TAXONOMY, type InconsistencyCode, type InconsistencySeverity } from "./fieldbeat-inconsistency-taxonomy";
import type { HistoricalPartMatchStatus } from "./fieldbeat-parts-history";
import { deriveEquipmentItems } from "./fieldbeat-equipment-derivation";
import {
  FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION,
  type FieldbeatInconsistencyDetail,
  type FieldbeatReportDetail,
  type FieldbeatTicketLink,
  type FieldbeatUsedPartDetail
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
        SELECT COALESCE(json_agg(json_build_object(
          'used_part_id', m.used_part_id,
          'part_name', m.part_name,
          'raw_part_identifier', m.raw_part_identifier,
          'normalized_part_identifier', m.normalized_part_identifier,
          'quantity', p.quantity,
          'match_status', m.match_status,
          'historical_match_status', hpm.historical_match_status,
          'dolibarr_product_id', dp.dolibarr_product_id::text,
          'dolibarr_ref', dp.ref,
          'dolibarr_label', dp.label,
          'dolibarr_barcode', dp.barcode::text,
          'candidate_dolibarr_product_ids', m.candidate_dolibarr_product_ids,
          'alias_value', alias.alias_value,
          'alias_reason', alias.reason,
          'alias_created_by', alias.created_by
        ) ORDER BY m.used_part_id), '[]'::json)
        FROM marts.used_parts_dolibarr_match m
        LEFT JOIN processed.fieldbeat_used_parts p ON p.used_part_id = m.used_part_id
        LEFT JOIN quality.fieldbeat_used_part_match hpm ON hpm.used_part_id = m.used_part_id
        LEFT JOIN processed.dolibarr_products dp ON dp.dolibarr_product_id = COALESCE(m.dolibarr_product_id, hpm.alias_resolved_dolibarr_product_id)
        LEFT JOIN LATERAL (
          SELECT pa.alias_value, pa.reason, pa.created_by
          FROM manual_review.part_aliases pa
          WHERE pa.active = true
            AND (
              (pa.alias_type = 'RAW' AND lower(pa.alias_value) = lower(coalesce(m.raw_part_identifier, '')))
              OR (pa.alias_type = 'NORMALIZED' AND lower(pa.alias_value) = lower(coalesce(m.normalized_part_identifier, '')))
            )
          LIMIT 1
        ) alias ON true
        WHERE m.fieldbeat_task_id = q.fieldbeat_task_id
      ) AS parts,
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

interface RawPartRow {
  used_part_id: string;
  part_name: string | null;
  raw_part_identifier: string | null;
  normalized_part_identifier: string | null;
  quantity: string | number | null;
  match_status: string | null;
  historical_match_status: HistoricalPartMatchStatus | null;
  dolibarr_product_id: string | null;
  dolibarr_ref: string | null;
  dolibarr_label: string | null;
  dolibarr_barcode: string | null;
  candidate_dolibarr_product_ids: string | null;
  alias_value: string | null;
  alias_reason: string | null;
  alias_created_by: string | null;
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
  parts: RawPartRow[];
  inconsistencies: RawInconsistencyRow[];
  primary_code: InconsistencyCode | null;
}

function shapeTicket(t: RawTicketRow): FieldbeatTicketLink {
  return { zendeskTicketId: t.zendesk_ticket_id, subject: t.subject, status: t.status, priority: t.priority, linkMethod: t.link_method };
}

function shapePart(p: RawPartRow): FieldbeatUsedPartDetail {
  const isAmbiguous = p.historical_match_status === "AMBIGUOUS_MATCH";
  const isHistoricalAlias = p.historical_match_status === "HISTORICAL_ALIAS_MATCH";
  return {
    usedPartId: p.used_part_id,
    partName: p.part_name,
    rawPartIdentifier: p.raw_part_identifier,
    normalizedPartIdentifier: p.normalized_part_identifier,
    quantity: p.quantity === null || p.quantity === undefined ? null : Number(p.quantity),
    matchStatus: p.match_status,
    historicalMatchStatus: p.historical_match_status,
    dolibarrProduct: p.dolibarr_product_id
      ? { productId: p.dolibarr_product_id, ref: p.dolibarr_ref, label: p.dolibarr_label, barcode: p.dolibarr_barcode }
      : null,
    // Nunca promueve una ambigüedad a match - candidatos solo se listan
    // cuando el status ES AMBIGUOUS_MATCH, nunca como "el" match.
    ambiguousCandidateProductIds: isAmbiguous && p.candidate_dolibarr_product_ids ? p.candidate_dolibarr_product_ids.split("|").filter(Boolean) : [],
    // "Equivalencias históricas disponibles solo cuando existe alias
    // validado" - sin fila real en manual_review.part_aliases, nunca se
    // muestra un alias aunque historical_match_status lo sugiera.
    historicalAlias: isHistoricalAlias && p.alias_value ? { aliasValue: p.alias_value, reason: p.alias_reason, createdBy: p.alias_created_by } : null
  };
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
    equipment: { status: row.team_identification_status, items: equipment },
    tickets: (row.tickets ?? []).map(shapeTicket),
    parts: (row.parts ?? []).map(shapePart),
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
