// Participantes 0..N y resumen laboral (HOTFIX de integridad de datos
// FieldBeat, post-Phase 6, sql/088_fieldbeat_part_occurrences_and_participants.sql).
// El responsable principal NUNCA se duplica como adicional (ya deduplicado
// en quality.fieldbeat_report_participants); un participante no resoluble
// NUNCA se descarta. Duración: separa COMPLETAMENTE lo real (declarado o
// transición validada) de la estimación de agenda - una estimación JAMÁS
// alimenta horas-persona/participación/productividad.
import type {
  FieldbeatActualDurationSource,
  FieldbeatLaborSummary,
  FieldbeatParticipant,
  ParticipantResolutionStatus,
  ParticipantRole
} from "@/types/fieldbeat-report-detail";

export interface RawParticipantRow {
  fieldbeat_task_id: string;
  raw_name: string;
  normalized_name: string;
  role: ParticipantRole;
  source_field: string;
  resolution_status: ParticipantResolutionStatus;
  is_primary: boolean;
}

export function shapeParticipant(row: RawParticipantRow): FieldbeatParticipant {
  return {
    rawName: row.raw_name,
    normalizedName: row.normalized_name,
    role: row.role,
    sourceField: row.source_field,
    resolutionStatus: row.resolution_status,
    isPrimary: row.is_primary
  };
}

const ROLE_ORDER: Record<ParticipantRole, number> = {
  PRIMARY_ASSIGNEE: 0,
  ADDITIONAL_STRUCTURED: 1,
  ADDITIONAL_FREE_TEXT: 2,
  UNRESOLVED_ADDITIONAL: 3
};

/**
 * Orden determinista para UI/PDF/CSV - responsable principal siempre
 * primero, luego adicionales estructurados, luego texto libre, luego no
 * resueltos (nunca al azar ni por orden de inserción de la DB).
 */
export function sortParticipants(participants: readonly FieldbeatParticipant[]): FieldbeatParticipant[] {
  return [...participants].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

export interface RawLaborSummaryRow {
  fieldbeat_task_id: string;
  actual_report_duration_minutes: number | string | null;
  actual_duration_source: FieldbeatActualDurationSource;
  scheduled_estimate_minutes: number | string | null;
  participant_count: number | string;
  total_labor_minutes: number | string | null;
  individual_time_available: boolean;
}

function toNumberOrNull(value: number | string | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function shapeLaborSummary(row: RawLaborSummaryRow): FieldbeatLaborSummary {
  return {
    actualReportDurationMinutes: toNumberOrNull(row.actual_report_duration_minutes),
    actualDurationSource: row.actual_duration_source,
    // Estimación de agenda - SIEMPRE mostrada como estimado/planificación,
    // NUNCA como horas reales/trabajadas/participación.
    scheduledEstimateMinutes: toNumberOrNull(row.scheduled_estimate_minutes),
    participantCount: Number(row.participant_count),
    // null cuando actualReportDurationMinutes es null - la vista SQL
    // (quality.fieldbeat_report_labor_summary) ya nunca lo rellena
    // multiplicando la estimación por participantes; esta función solo
    // preserva ese null, nunca lo reconstruye.
    totalLaborMinutes: toNumberOrNull(row.total_labor_minutes),
    individualTimeAvailable: row.individual_time_available
  };
}
