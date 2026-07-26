// Taxonomía de "Reportes con inconsistencias de información" (Gate B §2.7,
// §2.8; Gate C §14). Cada código tiene severidad fija, universo de
// aplicación y una explicación/acción, para que la bandeja nunca muestre
// una fila sin poder decir por qué está ahí. Solo se declaran acá los
// códigos con una señal real ya verificada contra Postgres local
// (24-jul-2026); PART_HISTORICAL_SKU_UNRESOLVED y variantes de
// normalización quedan fuera hasta tener evidencia propia, no se agregan
// por completar la lista.

import type { HistoricalPartMatchStatus } from "./fieldbeat-parts-history";
import type { TeamIdentificationStatus } from "./fieldbeat-team-identification";

export type InconsistencySeverity = "Alta" | "Media" | "Baja" | "Advertencia";

export type InconsistencyCode =
  | "TEMPORAL_IMPOSSIBLE_CHRONOLOGY"
  | "PART_AMBIGUOUS_MATCH"
  | "TEAM_TEXT_AMBIGUOUS"
  | "PART_NO_MATCH"
  | "TICKET_REPORTED_INACCESSIBLE"
  | "TEAM_MISSING"
  | "MIN_FIELDS_INCOMPLETE"
  | "PART_PLACEHOLDER_ONLY"
  | "FINISHED_ZERO_DURATION"
  | "FINISHED_NULL_DURATION";

export interface InconsistencyDefinition {
  code: InconsistencyCode;
  severity: InconsistencySeverity;
  condition: string;
  explanation: string;
  suggestedAction: string;
  universe: string;
}

// Orden = prioridad de desempate para primaryInconsistency(): dentro de la
// misma severidad, el primero declarado gana. Nunca se reordena por
// frecuencia (Gate C §14: "frecuencia no define severidad").
export const INCONSISTENCY_TAXONOMY: readonly InconsistencyDefinition[] = [
  {
    code: "TEMPORAL_IMPOSSIBLE_CHRONOLOGY",
    severity: "Alta",
    condition: "last_transition_at < start_time",
    explanation: "La última transición de estado ocurre antes del inicio registrado del reporte.",
    suggestedAction: "Revisar el reporte en FieldBeat y corregir el timestamp erróneo en origen.",
    universe: "Reportes con start_time y last_transition_at presentes"
  },
  {
    code: "PART_AMBIGUOUS_MATCH",
    severity: "Alta",
    condition: "Al menos una línea de repuesto con match_status = AMBIGUOUS_MATCH",
    explanation: "El repuesto declarado tiene múltiples candidatos posibles en el catálogo Dolibarr, sin un match único.",
    suggestedAction: "Revisar manualmente y, si corresponde, curar un alias en manual_review.part_aliases.",
    universe: "Reportes con al menos un repuesto"
  },
  {
    code: "TEAM_TEXT_AMBIGUOUS",
    severity: "Alta",
    condition: "Identificación de equipo = TEXT_AMBIGUOUS y no existe alternativa estructurada",
    explanation: "La descripción menciona más de un equipo candidato del mismo cliente, sin campo estructurado que lo resuelva.",
    suggestedAction: "Confirmar el equipo real con el técnico y completar el campo estructurado en FieldBeat.",
    universe: "Reportes cerrados sin equipment_internal_ids estructurado"
  },
  {
    code: "PART_NO_MATCH",
    severity: "Media",
    condition: "Al menos una línea de repuesto con match_status = NO_MATCH sin alias histórico aplicable",
    explanation: "El repuesto declarado no coincide con ningún producto del catálogo Dolibarr actual ni con un alias histórico curado.",
    suggestedAction: "Verificar si corresponde curar un alias histórico o si el repuesto está mal identificado en origen.",
    universe: "Reportes con al menos un repuesto"
  },
  {
    code: "TICKET_REPORTED_INACCESSIBLE",
    severity: "Media",
    condition: "zendesk_join_status = LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK",
    explanation: "El reporte informa un ticket de Zendesk, pero ese ticket no existe o no es accesible.",
    suggestedAction: "Confirmar el número de ticket con el técnico o revisar permisos de acceso en Zendesk.",
    universe: "Reportes con ticket informado (zendesk_join_status != NO_TICKET_REPORTED)"
  },
  {
    code: "TEAM_MISSING",
    severity: "Media",
    condition: "Identificación de equipo = MISSING",
    explanation: "El reporte cerrado no identifica ningún equipo, ni en campo estructurado ni de forma recuperable en la descripción.",
    suggestedAction: "Completar el campo de equipo en FieldBeat para reportes futuros del mismo tipo.",
    universe: "Reportes cerrados evaluables"
  },
  {
    code: "MIN_FIELDS_INCOMPLETE",
    severity: "Media",
    condition: "Falta técnico o cliente en un reporte cerrado",
    explanation: "El reporte cerrado no tiene los datos mínimos estructurales (técnico y/o cliente).",
    suggestedAction: "Completar los campos mínimos en FieldBeat antes de considerarlo cerrado.",
    universe: "Reportes cerrados evaluables"
  },
  {
    code: "PART_PLACEHOLDER_ONLY",
    severity: "Baja",
    condition: "Todas las líneas de repuesto son PLACEHOLDER_VALUE (sin NO_MATCH ni AMBIGUOUS_MATCH)",
    explanation: "El repuesto quedó registrado como valor placeholder, sin un problema de matching más grave asociado.",
    suggestedAction: "Normalizar el valor placeholder en el próximo ciclo de captura.",
    universe: "Reportes con al menos un repuesto"
  },
  {
    code: "FINISHED_ZERO_DURATION",
    severity: "Advertencia",
    condition: "state = FINISHED y duration_minutes = 0",
    explanation: "El reporte terminó con duración registrada de exactamente cero minutos.",
    suggestedAction: "Verificar si la duración real no se registró o si el reporte fue cerrado inmediatamente por error.",
    universe: "Reportes en estado FINISHED"
  },
  {
    code: "FINISHED_NULL_DURATION",
    severity: "Advertencia",
    condition: "state = FINISHED y duration_minutes es NULL",
    explanation: "El reporte terminó sin ningún valor de duración registrado (distinto de duración cero).",
    suggestedAction: "Verificar por qué no se capturó duración para este reporte finalizado.",
    universe: "Reportes en estado FINISHED"
  }
];

const SEVERITY_RANK: Record<InconsistencySeverity, number> = { Alta: 0, Media: 1, Baja: 2, Advertencia: 3 };
const TAXONOMY_BY_CODE: ReadonlyMap<InconsistencyCode, InconsistencyDefinition> = new Map(
  INCONSISTENCY_TAXONOMY.map(def => [def.code, def])
);

export interface ReportInconsistencyInput {
  isClosed: boolean;
  isFinished: boolean;
  chronologyImpossible: boolean;
  finishedZeroDuration: boolean;
  finishedNullDuration: boolean;
  teamIdentification: TeamIdentificationStatus;
  hasTicketReported: boolean;
  ticketAccessible: boolean | null;
  minimumFieldsComplete: boolean;
  partMatchStatuses: readonly HistoricalPartMatchStatus[];
}

export interface InconsistencyFinding {
  code: InconsistencyCode;
  severity: InconsistencySeverity;
}

export function classifyReportInconsistencies(input: ReportInconsistencyInput): InconsistencyFinding[] {
  const findings: InconsistencyFinding[] = [];
  const push = (code: InconsistencyCode) => {
    const def = TAXONOMY_BY_CODE.get(code);
    if (def) findings.push({ code, severity: def.severity });
  };

  if (input.chronologyImpossible) push("TEMPORAL_IMPOSSIBLE_CHRONOLOGY");
  if (input.partMatchStatuses.includes("AMBIGUOUS_MATCH")) push("PART_AMBIGUOUS_MATCH");
  if (input.teamIdentification === "TEXT_AMBIGUOUS") push("TEAM_TEXT_AMBIGUOUS");
  if (input.partMatchStatuses.includes("NO_MATCH")) push("PART_NO_MATCH");
  if (input.hasTicketReported && input.ticketAccessible === false) push("TICKET_REPORTED_INACCESSIBLE");
  if (input.isClosed && input.teamIdentification === "MISSING") push("TEAM_MISSING");
  if (input.isClosed && !input.minimumFieldsComplete) push("MIN_FIELDS_INCOMPLETE");
  if (
    input.partMatchStatuses.length > 0 &&
    input.partMatchStatuses.includes("PLACEHOLDER_VALUE") &&
    !input.partMatchStatuses.includes("NO_MATCH") &&
    !input.partMatchStatuses.includes("AMBIGUOUS_MATCH")
  ) {
    push("PART_PLACEHOLDER_ONLY");
  }
  if (input.isFinished && input.finishedZeroDuration) push("FINISHED_ZERO_DURATION");
  if (input.isFinished && input.finishedNullDuration) push("FINISHED_NULL_DURATION");

  return findings;
}

/**
 * Mayor severidad primero; empate resuelto por el orden de declaración en
 * INCONSISTENCY_TAXONOMY (nunca por frecuencia).
 */
export function primaryInconsistency(findings: readonly InconsistencyFinding[]): InconsistencyFinding | null {
  if (findings.length === 0) return null;
  return [...findings].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return INCONSISTENCY_TAXONOMY.findIndex(d => d.code === a.code) - INCONSISTENCY_TAXONOMY.findIndex(d => d.code === b.code);
  })[0];
}
