import type { TeamIdentificationStatus } from "./fieldbeat-team-identification";
import type { FieldbeatEquipmentIdentityItem } from "@/types/fieldbeat-report-detail";

export interface DeriveEquipmentItemsInput {
  equipmentInternalIds: string | null;
  teamIdentificationStatus: TeamIdentificationStatus;
  matchedCandidateIds: readonly string[] | null;
}

/**
 * Deriva la lista de equipos para el detalle maestro a partir de las mismas
 * columnas que ya alimentan quality.fieldbeat_team_identification - NUNCA
 * reimplementa la clasificación (STRUCTURED/TEXT_CONFIDENT/TEXT_AMBIGUOUS/
 * MISSING/NOT_APPLICABLE ya vienen decididos), solo proyecta esa decisión
 * a una lista de items. TEXT_AMBIGUOUS nunca se promueve a match
 * confirmado (Phase 5 §4.2) - se listan como candidatos, confirmed=false.
 */
export function deriveEquipmentItems({ equipmentInternalIds, teamIdentificationStatus, matchedCandidateIds }: DeriveEquipmentItemsInput): FieldbeatEquipmentIdentityItem[] {
  if (teamIdentificationStatus === "STRUCTURED_IDENTIFIED") {
    if (!equipmentInternalIds) return [];
    return equipmentInternalIds
      .split("|")
      .map(id => id.trim())
      .filter(id => id.length > 0)
      .map(internalId => ({ internalId, source: "STRUCTURED" as const, confirmed: true }));
  }

  if (teamIdentificationStatus === "TEXT_CONFIDENT_IDENTIFIED") {
    const candidates = matchedCandidateIds ?? [];
    if (candidates.length !== 1) return [];
    return [{ internalId: candidates[0], source: "TEXT_RECOVERED" as const, confirmed: true }];
  }

  if (teamIdentificationStatus === "TEXT_AMBIGUOUS") {
    return (matchedCandidateIds ?? []).map(internalId => ({ internalId, source: "TEXT_AMBIGUOUS_CANDIDATE" as const, confirmed: false }));
  }

  // MISSING / NOT_APPLICABLE - sin equipo que listar; el motivo se comunica
  // vía teamIdentificationStatus, nunca vía un item de equipo inventado.
  return [];
}
