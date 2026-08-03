import type { InconsistencyCode, InconsistencySeverity } from "@/lib/fieldbeat-inconsistency-taxonomy";
import type { TeamIdentificationStatus } from "@/lib/fieldbeat-team-identification";
import type { HistoricalPartMatchStatus } from "@/lib/fieldbeat-parts-history";
import type { ContractScheduleResult } from "@/types/contracts";

// HOTFIX de integridad de datos FieldBeat (post-Phase 6) - 2.0.0: reemplaza
// FieldbeatUsedPartDetail por FieldbeatPartOccurrence (separa declaración de
// correspondencia de catálogo, expone rawPartNumber SIEMPRE, nunca lo
// sustituye por un nombre) y agrega participants/labor (participantes 0..N +
// resumen de duración real vs. estimada). Bump MAYOR: el shape de `parts`
// cambia de forma incompatible (campos renombrados/reestructurados) -
// ningún consumidor debe asumir silenciosamente compatibilidad 1.0.0.
//
// 2.1.0 (Sección 14 del encargo NEXUS V3 After-Hours) - aditivo, nunca
// rompe 2.0.0: cada FieldbeatEquipmentItem gana model/modelResolutionStatus/
// equipmentFamily/serialNumbers/contracts/resolutionSource (antes solo
// internalId/source/confirmed), y FieldbeatReportDetail gana `issues`. Todo
// consumidor 2.0.0 (Búsqueda, FieldBeat Calidad) sigue funcionando sin
// cambios - los campos nuevos son adicionales, ninguno reemplaza uno
// existente.
//
// 2.2.0 (Bloque 2 NEXUS V3 - horario de cobertura contractual) - aditivo:
// FieldbeatContractRelation gana `schedule` (ContractScheduleResult, ver
// types/contracts.ts). Ningún consumidor 2.1.0 se rompe - el campo es
// adicional.
export const FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION = "2.2.0";

/** Fuente de un ítem de equipo - NUNCA promueve una ambigüedad a match
 * confirmado (ver lib/fieldbeat-equipment-derivation.ts). */
export type FieldbeatEquipmentSource = "STRUCTURED" | "TEXT_RECOVERED" | "TEXT_AMBIGUOUS_CANDIDATE";

/** Modelo/contrato de un equipo (config.contract_equipment_analysis) - RESOLVED
 * cuando los contratos vigentes concuerdan en 1 modelo, AMBIGUOUS cuando hay
 * 2+ en desacuerdo (model queda null a propósito), UNKNOWN cuando no hay
 * ningún contrato vigente vinculado. Mismo vocabulario que
 * EQUIPMENT_MODEL_RESOLUTION_COLUMNS en lib/explorer-sql.ts (reutilizado, no
 * reinventado). */
export type FieldbeatModelResolutionStatus = "RESOLVED" | "AMBIGUOUS" | "UNKNOWN";

/** Un contrato (config.contract_equipment_versions) como objeto propio, no
 * como un valor más de un arreglo paralelo - un equipo puede tener 2+
 * contratos a lo largo del tiempo (renovaciones) y cada uno viaja completo.
 * contractVersionId es la identidad real (contract_version_id, PK de
 * config.contract_equipment_versions) - nunca equipment_key, que identifica
 * el EQUIPO del lado del sistema de contratos, no un contrato puntual. */
export interface FieldbeatContractRelation {
  contractVersionId: string;
  statusCode: string | null;
  spaTierCode: string | null;
  partsCoverageCode: string | null;
  warrantyEndDate: string | null;
  /** Horario de cobertura contractual de ESTA versión puntual (Bloque 2
   * NEXUS V3) - ver types/contracts.ts. Resuelto por
   * mapServiceWindowRowsToCoverageSchedule() (lib/contract-coverage-schedule.ts),
   * el mismo mapper que usa el drawer de Contratos - nunca reimplementado acá. */
  schedule: ContractScheduleResult;
}

/** De dónde salió el enriquecimiento de modelo/familia/serie/contrato de
 * este ítem - TASK_EQUIPMENT_LINK cuando processed.fieldbeat_task_equipments
 * tiene al menos una fila para la tarea (vínculo estructurado real, caso
 * dominante: 82.7% de las tareas medido contra datos reales), TEXT_FALLBACK
 * SOLO cuando esa tabla no tiene ninguna fila para la tarea (reporte con
 * equipo minado de texto libre, sin selección estructurada en FieldBeat) -
 * nunca se mezclan silenciosamente, ver buildReportDetailQuery. Deliberadamente
 * un campo propio, no inferido de `source` (que viene de una fuente distinta,
 * quality.fieldbeat_team_identification, sin correlación 1:1 demostrada). */
export type FieldbeatEquipmentResolutionSource = "TASK_EQUIPMENT_LINK" | "TEXT_FALLBACK";

/** Identidad de un equipo de reporte - exactamente lo que
 * deriveEquipmentItems() (lib/fieldbeat-equipment-derivation.ts) puede
 * determinar desde team_identification_status/matched_candidate_ids, sin
 * saber nada de modelo/contrato. Separado de FieldbeatEquipmentItem a
 * propósito: esa función nunca debe requerir conocer el enriquecimiento de
 * modelo/contrato para poder tipar su retorno. */
export interface FieldbeatEquipmentIdentityItem {
  internalId: string;
  source: FieldbeatEquipmentSource;
  /** true solo para STRUCTURED/TEXT_RECOVERED - un candidato ambiguo nunca es "confirmed". */
  confirmed: boolean;
}

export interface FieldbeatEquipmentItem extends FieldbeatEquipmentIdentityItem {
  resolutionSource: FieldbeatEquipmentResolutionSource;
  model: string | null;
  modelResolutionStatus: FieldbeatModelResolutionStatus;
  equipmentFamily: string | null;
  serialNumbers: string[];
  contracts: FieldbeatContractRelation[];
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

/** Una incidencia de gobierno (governance.issues) activa para este reporte -
 * solo id/rule_code/severity/status/first_seen_at (identificador legible +
 * estado, no el detalle completo de evidencia - eso vive en el flujo de
 * Auditoría, este drawer solo enlaza hacia allá). */
export interface FieldbeatReportIssue {
  id: number;
  ruleCode: string;
  severity: string;
  status: string;
  firstSeenAt: string;
}

/** governance.issues solo es legible por el rol de gobierno
 * (runGovernanceQuery), una query aparte de la del detalle base (pools
 * distintos, nunca el mismo SELECT) - su falla NUNCA debe tumbar el
 * detalle base del reporte. `T[] | null` es ambiguo (¿null es "no verificado"
 * o alguien lo trata como "sin incidencias"?) - unión discriminada explícita,
 * mismo principio que ExplorerLoadState ya establece en el resto de la app:
 * "available" (confirmado por el backend, incluso si issues=[]) vs.
 * "unavailable" (degradado - la query de incidencias falló, el resto del
 * detalle sigue siendo válido). */
export type FieldbeatIssuesAvailability = { status: "available"; issues: FieldbeatReportIssue[] } | { status: "unavailable" };

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
  /** Incidencias activas de gobierno para este reporte (Sección 14 del
   * encargo NEXUS V3 After-Hours) - ver FieldbeatIssuesAvailability. */
  issues: FieldbeatIssuesAvailability;
  audit: FieldbeatAuditMetadata;
}
