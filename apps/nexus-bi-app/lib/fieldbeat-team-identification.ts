// Identificación de equipo por reporte FieldBeat (Gate B §2.2/§2.3, Gate C
// §11). marts.fieldbeat_report_dolibarr_operational_view.equipment_internal_ids
// (estructurado) queda vacío en 606/3.609 reportes cerrados (reconciliación
// local, 24-jul-2026); una muestra de esas descripciones confirma ambos
// casos reales: tokens de equipo recuperables ("revision de monaco06") y
// tareas genuinamente sin equipo físico ("Apoyo remoto Andes Salud"). Este
// módulo NO decide NOT_APPLICABLE por tipo de tarea (prohibido por Gate B
// §2.3) - solo lo acepta como evidencia ya demostrada, provista por quien
// llama.

export type TeamIdentificationStatus =
  | "STRUCTURED_IDENTIFIED"
  | "TEXT_CONFIDENT_IDENTIFIED"
  | "TEXT_AMBIGUOUS"
  | "MISSING"
  | "NOT_APPLICABLE";

export interface TeamIdentificationCandidate {
  /** Identificador de equipo tal como aparece en processed.fieldbeat_equipments (internal_id o equipment_key), scoped al mismo client_key del reporte. */
  id: string;
  label?: string;
}

export interface TeamIdentificationInput {
  structuredEquipmentIds: readonly string[];
  description: string | null;
  /** Candidatos de equipo del MISMO cliente - nunca la flota completa, para no inflar colisiones. */
  candidates: readonly TeamIdentificationCandidate[];
  /** Motivo de NOT_APPLICABLE ya demostrado por una regla de dominio explícita - nunca inferido acá. */
  notApplicableReason?: string | null;
}

export interface TeamIdentificationResult {
  status: TeamIdentificationStatus;
  matchedCandidateIds: readonly string[];
  evidence: string | null;
}

const MIN_TOKEN_LENGTH = 3;

/**
 * Tokeniza en minúsculas, separando por cualquier caracter no
 * alfanumérico EXCEPTO el guion - los internal_id reales de
 * processed.fieldbeat_equipments usan guion como separador habitual
 * ("Linac-153935", "TPS-UC", "HDR-FT02211": ver reconciliación local,
 * 24-jul-2026) y partirlos ahí volvía irrecuperable cualquier código
 * hyphenado mencionado en texto libre. Deliberadamente simple más allá de
 * eso (sin stemming/acentos) - cualquier ampliación futura debe venir con
 * evidencia de falsos negativos reales, no especulación.
 */
export function tokenizeDescription(description: string): readonly string[] {
  return description
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(token => token.length >= MIN_TOKEN_LENGTH);
}

export function classifyTeamIdentification(input: TeamIdentificationInput): TeamIdentificationResult {
  if (input.structuredEquipmentIds.length > 0) {
    return {
      status: "STRUCTURED_IDENTIFIED",
      matchedCandidateIds: input.structuredEquipmentIds,
      evidence: `Campo estructurado: ${input.structuredEquipmentIds.join(", ")}`
    };
  }

  if (input.notApplicableReason) {
    return { status: "NOT_APPLICABLE", matchedCandidateIds: [], evidence: input.notApplicableReason };
  }

  const description = input.description?.trim();
  if (!description || input.candidates.length === 0) {
    return { status: "MISSING", matchedCandidateIds: [], evidence: null };
  }

  const tokens = new Set(tokenizeDescription(description));
  const matched = input.candidates.filter(
    candidate => candidate.id.length >= MIN_TOKEN_LENGTH && tokens.has(candidate.id.toLowerCase())
  );

  if (matched.length === 1) {
    return {
      status: "TEXT_CONFIDENT_IDENTIFIED",
      matchedCandidateIds: [matched[0].id],
      evidence: `Token "${matched[0].id}" recuperado de la descripción`
    };
  }

  if (matched.length > 1) {
    const ids = matched.map(c => c.id);
    return {
      status: "TEXT_AMBIGUOUS",
      matchedCandidateIds: ids,
      evidence: `Múltiples candidatos en la descripción: ${ids.join(", ")}`
    };
  }

  return { status: "MISSING", matchedCandidateIds: [], evidence: null };
}
