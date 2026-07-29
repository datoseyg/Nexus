import type { InconsistencyCode, InconsistencySeverity } from "@/lib/fieldbeat-inconsistency-taxonomy";
import type { TeamIdentificationStatus } from "@/lib/fieldbeat-team-identification";
import type { HistoricalPartMatchStatus } from "@/lib/fieldbeat-parts-history";

// HOTFIX de integridad de datos FieldBeat (post-Phase 6) - 2.0.0: reemplaza
// FieldbeatUsedPartDetail por FieldbeatPartOccurrence (separa declaración de
// correspondencia de catálogo, expone rawPartNumber SIEMPRE, nunca lo
// sustituye por un nombre) y agrega participants/labor (participantes 0..N +
// resumen de duración real vs. estimada). Bump MAYOR: el shape de `parts`
// cambia de forma incompatible (campos renombrados/reestructurados) -
// ningún consumidor debe asumir silenciosamente compatibilidad 1.0.0.
export const FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION = "2.0.0";

/** Fuente de un ítem de equipo - NUNCA promueve una ambigüedad a match
 * confirmado (ver lib/fieldbeat-equipment-derivation.ts). */
export type FieldbeatEquipmentSource = "STRUCTURED" | "TEXT_RECOVERED" | "TEXT_AMBIGUOUS_CANDIDATE";

export interface FieldbeatEquipmentItem {
  internalId: string;
  source: FieldbeatEquipmentSource;
  /** true solo para STRUCTURED/TEXT_RECOVERED - un candidato ambiguo nunca es "confirmed". */
  confirmed: boolean;
}

export interface FieldbeatReportIdentity {
  fieldbeatTaskId: string;
  state: string | null;
  isClosed: boolean;
  isFinished: boolean;
  taskType: string | null;
  origen: string | null;
  clientName: string | null;
  reportQualityStatus: string | null;
  fieldbeatTaskDate: string | null;
}

export interface FieldbeatChronology {
  createdAt: string | null;
  startTime: string | null;
  lastTransitionAt: string | null;
  durationMinutes: number | null;
  chronologyImpossible: boolean;
  hasSufficientTimestamps: boolean;
  finishedZeroDuration: boolean;
  finishedNullDuration: boolean;
}

export interface FieldbeatTechnician {
  name: string;
}

export interface FieldbeatClient {
  clientKey: string;
  clientName: string;
}

export interface FieldbeatEquipmentIdentification {
  status: TeamIdentificationStatus;
  items: FieldbeatEquipmentItem[];
  /** Valor crudo del que se derivaron los candidatos (equipment_internal_ids,
   * pipe-delimited) - expuesto SOLO para que Administración pueda corregir la
   * identificación de equipo (Gate B, Familia 5, correction:equipment-identification)
   * contra el mismo valor que originó la ambigüedad, nunca inventado. */
  rawEquipmentReference: string | null;
}

export interface FieldbeatTicketLink {
  zendeskTicketId: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  linkMethod: string | null;
}

/** Presencia/declaración en el reporte - SIEMPRE 'DECLARED_IN_REPORT' hoy
 * (quality.fieldbeat_report_part_occurrences solo materializa líneas
 * realmente declaradas). 'NOT_DECLARED_IN_REPORT' documentado, rama no
 * alcanzable hoy - mismo patrón que descriptionConfidentOverride en
 * lib/fieldbeat-parts-history.ts (se deja en el vocabulario para no
 * reescribir el contrato después, nunca inferido acá). */
export type PartDeclarationStatus = "DECLARED_IN_REPORT" | "NOT_DECLARED_IN_REPORT";

export interface FieldbeatPartAttachment {
  filename: string;
  /** SIEMPRE false hoy - FieldBeat solo entrega el nombre de archivo de la
   * foto del repuesto (ver "FOTO DEL REPUESTO UTILIZADO"), nunca los bytes
   * ni otra metadata, en ninguna capa local del pipeline. */
  bytesAvailable: boolean;
}

/** Evidencia de la correspondencia de catálogo - discriminada por `kind`
 * para que un consumidor nunca lea `candidateProductIds`/`aliasValue` de un
 * estado al que no corresponden. */
export type FieldbeatPartMatchEvidence =
  | { kind: "NONE" }
  | { kind: "AMBIGUOUS_CANDIDATES"; candidateProductIds: string[] }
  | { kind: "HISTORICAL_ALIAS"; aliasValue: string; reason: string | null; createdBy: string | null };

/**
 * Ocurrencia canónica de repuesto (HOTFIX de integridad, sql/088) - fuente
 * única compartida por FieldBeat/Búsqueda/PDF/CSV (quality.fieldbeat_report_part_occurrences).
 * Separa PRESENCIA (declarationStatus) de CORRESPONDENCIA DE CATÁLOGO
 * (catalogMatchStatus) - catalogMatchStatus='NO_MATCH' significa
 * ÚNICAMENTE "declarado, sin correspondencia validada en Dolibarr", NUNCA
 * "no existe" ni "no fue declarado". rawName/rawPartNumber viajan SIEMPRE
 * juntos - rawPartNumber nunca se oculta detrás de rawName ni viceversa.
 */
export interface FieldbeatPartOccurrence {
  lineId: string;
  fieldbeatTaskId: string;
  rawName: string | null;
  /** Número/código de parte tal como se declaró - SIEMPRE visible en la UI, nunca enmascarado por rawName. */
  rawPartNumber: string | null;
  quantity: number | null;
  sourceLocation: string | null;
  sourceComment: string | null;
  attachment: FieldbeatPartAttachment | null;
  declarationStatus: PartDeclarationStatus;
  catalogMatchStatus: HistoricalPartMatchStatus;
  matchedProductId: string | null;
  matchedSku: string | null;
  matchEvidence: FieldbeatPartMatchEvidence;
  /** Explicación en lenguaje llano de catalogMatchStatus - fuente única
   * (lib/fieldbeat-part-occurrence.ts) para que las 5 superficies (FieldBeat/
   * Búsqueda/PDF/CSV/drawer) muestren EXACTAMENTE el mismo texto, nunca cada
   * una reinterpretando el enum por su cuenta. */
  explanation: string;
}

/** Roles de participante 0..N (HOTFIX de integridad, sql/088). El
 * responsable principal NUNCA se duplica como adicional (deduplicación ya
 * resuelta en quality.fieldbeat_report_participants). */
export type ParticipantRole = "PRIMARY_ASSIGNEE" | "ADDITIONAL_STRUCTURED" | "ADDITIONAL_FREE_TEXT" | "UNRESOLVED_ADDITIONAL";

/** Cómo se resolvió la identidad de un participante - distingue
 * explícitamente evidencia automática (RESOLVED_ASSIGNED_TO/RESOLVED_ROSTER_MATCH)
 * de verificación manual (RESOLVED_CURATED_IDENTITY, ver
 * manual_review.fieldbeat_engineer_identity_map.verification_method) - un
 * participante no resoluble NUNCA se descarta (UNRESOLVED_*). */
export type ParticipantResolutionStatus =
  | "RESOLVED_ASSIGNED_TO"
  | "RESOLVED_ROSTER_MATCH"
  | "RESOLVED_CURATED_IDENTITY"
  | "UNRESOLVED_FREE_TEXT"
  | "UNRESOLVED_UNKNOWN_TOKEN";

export interface FieldbeatParticipant {
  rawName: string;
  normalizedName: string;
  role: ParticipantRole;
  sourceField: string;
  resolutionStatus: ParticipantResolutionStatus;
  isPrimary: boolean;
}

/** Fuente de actualReportDurationMinutes - JAMÁS incluye un tier de
 * estimación: 'duration'/'duration_minutes' de agenda es siempre una
 * estimación de agenda (valores preset repetidos, confirmado empíricamente),
 * nunca una medición real, así que nunca alimenta esta cadena (ver
 * scheduledEstimateMinutes, campo separado). VALIDATED_WORK_TRANSITION_INTERVAL
 * documentado, sin evidencia de datos que lo disparen hoy para ningún tipo
 * de reporte (rama no alcanzable hoy, no se descarta del vocabulario). */
export type FieldbeatActualDurationSource = "FORM_DECLARED_INTERVAL" | "VALIDATED_WORK_TRANSITION_INTERVAL" | "UNAVAILABLE";

/**
 * Resumen laboral por reporte (HOTFIX de integridad, sql/088) - separa
 * COMPLETAMENTE duración real de estimación de agenda. Una estimación
 * JAMÁS alimenta totalLaborMinutes/horas-persona/participación/
 * productividad - ausencia de duración real produce `null`, nunca una
 * estimación disfrazada de dato real.
 */
export interface FieldbeatLaborSummary {
  actualReportDurationMinutes: number | null;
  actualDurationSource: FieldbeatActualDurationSource;
  /** SIEMPRE mostrado como estimado/planificación, NUNCA como horas reales/trabajadas/participación. */
  scheduledEstimateMinutes: number | null;
  participantCount: number;
  /** null cuando actualReportDurationMinutes es null - NUNCA se rellena multiplicando la estimación por participantes. */
  totalLaborMinutes: number | null;
  /** SIEMPRE false hoy - FieldBeat nunca capta fichaje individual por participante. */
  individualTimeAvailable: boolean;
}

export interface FieldbeatInconsistencyDetail {
  code: InconsistencyCode;
  severity: InconsistencySeverity;
  priorityOrder: number;
  isPrimary: boolean;
  explanation: string;
  suggestedAction: string;
  universe: string;
}

export interface FieldbeatQualityDetail {
  structurallyComplete: boolean;
  minimumFieldsComplete: boolean;
  hasTechnician: boolean;
  hasClient: boolean;
  teamIdentificationStatus: TeamIdentificationStatus;
  partFullyTraceable: boolean;
  partTotalLines: number;
  hasSufficientTimestamps: boolean;
  chronologyImpossible: boolean;
  ticketAccessible: boolean | null;
  ticketMissingOrRestricted: boolean;
  totalInconsistencies: number;
}

export interface FieldbeatAuditMetadata {
  contractVersion: string;
  generatedAt: string;
  /** Phase 6 - refleja isFieldbeatOpenConfigured() del servidor (fleet/token
   * presentes), SIN exponer sus valores. El cliente usa esto para
   * habilitar/deshabilitar "Abrir en FieldBeat" sin poder ver la config. */
  fieldbeatOpenAvailable: boolean;
}

export interface FieldbeatReportDetail {
  contractVersion: string;
  generatedAt: string;
  report: FieldbeatReportIdentity;
  chronology: FieldbeatChronology;
  technician: FieldbeatTechnician | null;
  client: FieldbeatClient | null;
  equipment: FieldbeatEquipmentIdentification;
  tickets: FieldbeatTicketLink[];
  parts: FieldbeatPartOccurrence[];
  /** Participantes 0..N (HOTFIX de integridad) - incluye SIEMPRE al
   * responsable principal (role=PRIMARY_ASSIGNEE) más 0..N adicionales,
   * nunca duplicados. `technician` arriba se conserva por compatibilidad
   * de lectura rápida (mismo valor que el participante PRIMARY_ASSIGNEE). */
  participants: FieldbeatParticipant[];
  labor: FieldbeatLaborSummary;
  quality: FieldbeatQualityDetail;
  inconsistencies: FieldbeatInconsistencyDetail[];
  audit: FieldbeatAuditMetadata;
}
