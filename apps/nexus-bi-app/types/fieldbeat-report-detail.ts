import type { InconsistencyCode, InconsistencySeverity } from "@/lib/fieldbeat-inconsistency-taxonomy";
import type { TeamIdentificationStatus } from "@/lib/fieldbeat-team-identification";
import type { HistoricalPartMatchStatus } from "@/lib/fieldbeat-parts-history";

export const FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION = "1.0.0";

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
}

export interface FieldbeatTicketLink {
  zendeskTicketId: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  linkMethod: string | null;
}

export interface FieldbeatUsedPartDetail {
  usedPartId: string;
  partName: string | null;
  rawPartIdentifier: string | null;
  normalizedPartIdentifier: string | null;
  quantity: number | null;
  matchStatus: string | null;
  historicalMatchStatus: HistoricalPartMatchStatus | null;
  dolibarrProduct: { productId: string; ref: string | null; label: string | null; barcode: string | null } | null;
  /** Candidatos cuando historicalMatchStatus=AMBIGUOUS_MATCH - nunca promovidos a match. */
  ambiguousCandidateProductIds: string[];
  /** Solo presente cuando historicalMatchStatus=HISTORICAL_ALIAS_MATCH Y existe evidencia real en manual_review.part_aliases. */
  historicalAlias: { aliasValue: string; reason: string | null; createdBy: string | null } | null;
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
  parts: FieldbeatUsedPartDetail[];
  quality: FieldbeatQualityDetail;
  inconsistencies: FieldbeatInconsistencyDetail[];
  audit: FieldbeatAuditMetadata;
}
