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
import { EQUIPMENT_CANONICAL_CTE, EQUIPMENT_MODEL_RESOLUTION_COLUMNS, equipmentContractCandidatesLateral } from "./explorer-sql";
import { runGovernanceQuery } from "./governance-db";
import {
  FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION,
  type FieldbeatContractRelation,
  type FieldbeatEquipmentIdentityItem,
  type FieldbeatEquipmentItem,
  type FieldbeatEquipmentResolutionSource,
  type FieldbeatInconsistencyDetail,
  type FieldbeatIssuesAvailability,
  type FieldbeatModelResolutionStatus,
  type FieldbeatReportDetail,
  type FieldbeatReportIssue,
  type FieldbeatTicketLink
} from "@/types/fieldbeat-report-detail";
import type { ContractScheduleResult } from "@/types/contracts";

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

// Correlación de canonical_equipment.source_equipment_keys contra
// config.contract_equipment_analysis - MISMO predicado que usa el
// Explorador (ver CANONICAL_EQUIPMENT_CONTRACT_PREDICATE en explorer-sql.ts,
// no exportado por ser un detalle interno de ese archivo) - se repite acá
// literal en vez de exportar esa constante porque el predicado real es
// `canonical_equipment.source_equipment_keys`/`ce.source_equipment_keys`
// según el alias que tenga la CTE en cada consulta (acá se alía `ce`, no
// `canonical_equipment`, para dejar claro dentro del subquery de equipos que
// es una fila puntual, no la CTE completa).
const REPORT_EQUIPMENT_CONTRACT_PREDICATE = "ca.fieldbeat_equipment_key = ANY(ce.source_equipment_keys)";

export function buildReportDetailQuery(fieldbeatTaskId: string): ReportDetailQueryResult {
  const sql = `
    ${EQUIPMENT_CANONICAL_CTE}
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
        -- Enriquecimiento de modelo/familia/serie/contrato por equipo
        -- (Sección 14 del encargo NEXUS V3 After-Hours) - NUNCA reemplaza la
        -- identidad ya resuelta por deriveEquipmentItems()/matched_candidate_ids
        -- (eso sigue siendo team_identification_status), solo la enriquece
        -- por internal_id normalizado. Precedencia estructurada real:
        -- processed.fieldbeat_task_equipments (1 fila por par tarea-equipo,
        -- medido: 82.7% de las tareas la tienen) es SIEMPRE la fuente
        -- primaria; el fallback de texto (UNNEST de equipment_internal_ids)
        -- solo se activa cuando esa tabla no tiene NINGUNA fila para esta
        -- tarea (NOT EXISTS) - nunca cuando hay filas estructuradas que
        -- simplemente no matchean canonical_equipment (ahí queda con
        -- model=null/UNKNOWN vía LEFT JOIN, nunca se descarta la fila ni se
        -- cae al fallback de texto silenciosamente).
        SELECT COALESCE(json_agg(json_build_object(
          'internal_id', item.internal_id,
          'resolution_source', item.resolution_source,
          'model', item.model,
          'model_resolution_status', item.model_resolution_status,
          'equipment_family', item.equipment_type,
          'serial_numbers', item.serial_numbers,
          'contracts', item.contracts
        ) ORDER BY item.internal_id), '[]'::json)
        FROM (
          SELECT
            ce.internal_id,
            eq.resolution_source,
            ce.equipment_type,
            ${EQUIPMENT_MODEL_RESOLUTION_COLUMNS},
            COALESCE(contract.serial_numbers, ARRAY[]::text[]) AS serial_numbers,
            (
              SELECT COALESCE(json_agg(json_build_object(
                'contract_version_id', ca.contract_version_id::text,
                'status_code', ca.contract_status_code,
                'spa_tier_code', ca.spa_tier_code,
                'parts_coverage_code', ca.parts_coverage_code,
                'warranty_end_date', ca.warranty_end_date,
                'valid_from', ca.valid_from,
                'valid_to', ca.valid_to
              ) ORDER BY ca.contract_version_id), '[]'::json)
              FROM config.contract_equipment_analysis ca
              WHERE ca.is_current = true AND ca.fieldbeat_equipment_key = ANY(ce.source_equipment_keys)
            ) AS contracts
          FROM (
            SELECT te.equipment_internal_id AS raw_internal_id, 'TASK_EQUIPMENT_LINK' AS resolution_source
            FROM processed.fieldbeat_task_equipments te
            WHERE te.fieldbeat_task_id = q.fieldbeat_task_id
            UNION ALL
            SELECT TRIM(unnested.value), 'TEXT_FALLBACK'
            FROM UNNEST(STRING_TO_ARRAY(COALESCE(q.equipment_internal_ids, ''), '|')) AS unnested(value)
            WHERE TRIM(unnested.value) <> ''
              AND NOT EXISTS (SELECT 1 FROM processed.fieldbeat_task_equipments te2 WHERE te2.fieldbeat_task_id = q.fieldbeat_task_id)
          ) eq
          JOIN canonical_equipment ce ON ce.internal_id = UPPER(TRIM(eq.raw_internal_id))
          ${equipmentContractCandidatesLateral(REPORT_EQUIPMENT_CONTRACT_PREDICATE)}
        ) item
      ) AS equipment_enrichment,
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

interface RawContractRelationRow {
  contract_version_id: string;
  status_code: string | null;
  spa_tier_code: string | null;
  parts_coverage_code: string | null;
  warranty_end_date: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

interface RawEquipmentEnrichmentRow {
  internal_id: string;
  resolution_source: FieldbeatEquipmentResolutionSource;
  model: string | null;
  model_resolution_status: FieldbeatModelResolutionStatus;
  equipment_family: string | null;
  serial_numbers: string[];
  contracts: RawContractRelationRow[];
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
  equipment_enrichment: RawEquipmentEnrichmentRow[];
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

// scheduleByVersionId (Bloque 2 NEXUS V3) - resuelto ANTES por el caller
// (una sola consulta batch, ANY($1::bigint[]) - ver
// fetchContractScheduleResultsByVersionIds en lib/explorer-sql.ts), nunca
// una consulta por contrato acá. Esta función se mantiene pura (solo mapea
// filas ya traídas), igual que el resto de shape*() de este archivo.
// UNAVAILABLE de respaldo si el mapa no trae este contract_version_id (no
// debería ocurrir si el caller batcheó exactamente los IDs de esta misma
// fila, pero nunca se asume - "no encontrado en el mapa" nunca se confunde
// con MISSING, que significa "se consultó y no existe schedule").
function shapeContractRelation(c: RawContractRelationRow, scheduleByVersionId: Map<string, ContractScheduleResult>): FieldbeatContractRelation {
  return {
    contractVersionId: c.contract_version_id,
    statusCode: c.status_code,
    spaTierCode: c.spa_tier_code,
    partsCoverageCode: c.parts_coverage_code,
    warrantyEndDate: c.warranty_end_date,
    schedule: scheduleByVersionId.get(c.contract_version_id) ?? { status: "UNAVAILABLE", schedule: null }
  };
}

// Combina la identidad de equipo YA resuelta por deriveEquipmentItems()
// (team_identification_status/matched_candidate_ids - nunca tocada acá) con
// el enriquecimiento de modelo/familia/serie/contrato de equipment_enrichment
// (fuente independiente, ver comentario en buildReportDetailQuery). Ambas
// listas pueden diverger en casos raros (ítem de texto ambiguo sin ninguna
// fila en processed.fieldbeat_task_equipments ni en equipment_internal_ids)
// - un ítem sin enriquecimiento correspondiente degrada a "sin dato" en vez
// de fallar, nunca inventa un modelo/contrato.
function mergeEquipmentEnrichment(
  items: FieldbeatEquipmentIdentityItem[],
  enrichment: RawEquipmentEnrichmentRow[],
  scheduleByVersionId: Map<string, ContractScheduleResult>
): FieldbeatEquipmentItem[] {
  const byInternalId = new Map(enrichment.map(e => [e.internal_id.toUpperCase().trim(), e]));

  return items.map(item => {
    const match = byInternalId.get(item.internalId.toUpperCase().trim());
    if (!match) {
      return {
        ...item,
        resolutionSource: "TEXT_FALLBACK",
        model: null,
        modelResolutionStatus: "UNKNOWN",
        equipmentFamily: null,
        serialNumbers: [],
        contracts: []
      };
    }
    return {
      ...item,
      resolutionSource: match.resolution_source,
      model: match.model,
      modelResolutionStatus: match.model_resolution_status,
      equipmentFamily: match.equipment_family,
      serialNumbers: match.serial_numbers ?? [],
      contracts: (match.contracts ?? []).map(c => shapeContractRelation(c, scheduleByVersionId))
    };
  });
}

/** Recolecta los contract_version_id de TODOS los contratos de TODOS los
 * equipos de una fila de detalle de reporte - el caller (route.ts) los
 * batchea en una sola consulta antes de llamar a shapeReportDetail(), nunca
 * una consulta por contrato. Exportada para que el caller no tenga que
 * conocer la forma cruda de equipment_enrichment. */
export function collectReportContractVersionIds(
  row: Pick<ReportDetailQueryRow, "equipment_enrichment">
): Array<{ contractVersionId: string; validFrom: string | null; validTo: string | null }> {
  const seen = new Map<string, { contractVersionId: string; validFrom: string | null; validTo: string | null }>();
  for (const item of row.equipment_enrichment ?? []) {
    for (const c of item.contracts ?? []) {
      if (!seen.has(c.contract_version_id)) {
        seen.set(c.contract_version_id, { contractVersionId: c.contract_version_id, validFrom: c.valid_from, validTo: c.valid_to });
      }
    }
  }
  return Array.from(seen.values());
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
export function shapeReportDetail(
  row: ReportDetailQueryRow,
  fieldbeatOpenAvailable: boolean,
  issues: FieldbeatIssuesAvailability,
  scheduleByVersionId: Map<string, ContractScheduleResult> = new Map()
): FieldbeatReportDetail {
  const equipment = mergeEquipmentEnrichment(
    deriveEquipmentItems({
      equipmentInternalIds: row.equipment_internal_ids,
      teamIdentificationStatus: row.team_identification_status,
      matchedCandidateIds: row.matched_candidate_ids
    }),
    row.equipment_enrichment ?? [],
    scheduleByVersionId
  );

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
    issues,
    audit: {
      contractVersion: FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      fieldbeatOpenAvailable
    }
  };
}

interface RawIssueRow {
  id: number;
  rule_code: string;
  severity: string;
  status: string;
  first_seen_at: string;
}

// governance.issues solo es legible por el rol de gobierno (nexus_app_read)
// - NUNCA puede ir dentro del mismo SELECT que buildReportDetailQuery, que
// corre contra el pool genérico (runQuery). Query aparte, en paralelo (ver
// app/api/dashboard/fieldbeat/reports/[id]/route.ts::Promise.allSettled) -
// una falla acá NUNCA debe tumbar el detalle base del reporte.
export async function fetchReportActiveIssues(fieldbeatTaskId: string): Promise<FieldbeatReportIssue[]> {
  const rows = await runGovernanceQuery<RawIssueRow>(
    "app_read",
    `SELECT id, rule_code, severity, status, first_seen_at
     FROM governance.issues
     WHERE entity_type = 'report' AND entity_key = $1 AND is_currently_detected = true AND status IN ('OPEN', 'IN_REVIEW')
     ORDER BY severity, first_seen_at`,
    [fieldbeatTaskId]
  );

  return rows.map(r => ({ id: r.id, ruleCode: r.rule_code, severity: r.severity, status: r.status, firstSeenAt: r.first_seen_at }));
}
