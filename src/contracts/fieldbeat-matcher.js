import { normalizeSerialForMatching, extractTrailingSerial } from "./normalize-serial.js";

// Hallazgo verificado (sql/010_processed.sql:32-54): processed.fieldbeat_clients
// y processed.fieldbeat_equipments NO tienen ningún campo de "sede" real
// equivalente a site_abbreviation del contrato (CAS-Nor/CAS-Sur/UC-CECA/...).
// El tercer nivel de matching se implementa por lo tanto como
// cliente-canónico + categoría de equipo (nunca sede) -si esa combinación
// produce más de un candidato (dos Linac del mismo cliente, por ejemplo),
// el resultado es AMBIGUOUS, nunca autoconfirmado. El método se sigue
// llamando CLIENT_SITE_MODEL en el enum de match_method por continuidad
// con el encargo, pero la implementación real es cliente+categoría.

// Allowlist cerrada de modelo de equipo (columna "Equipo" del contrato) ->
// categoría gruesa de FieldBeat (equipment_type), igual granularidad que
// classifyEquipmentType() en src/normalizers/fieldbeat-normalizer.js. Nunca
// se infiere dinámicamente una categoría no listada acá.
const EQUIPMENT_MODEL_TO_CATEGORY = {
  synergy: "LINAC",
  axesse: "LINAC",
  versahd: "LINAC",
  infinity: "LINAC",
  platform: "LINAC",
  compact: "LINAC",
  precise: "LINAC",
  microselectron: "BRAQUITERAPIA",
  flexitron: "BRAQUITERAPIA"
};

function classifyContractEquipmentModel(equipmentModel) {
  const key = String(equipmentModel ?? "").trim().toLowerCase();
  return EQUIPMENT_MODEL_TO_CATEGORY[key] ?? null;
}

function classifyFieldbeatInternalId(internalId) {
  const value = String(internalId ?? "").toLowerCase();
  if (value.includes("linac")) return "LINAC";
  if (value.includes("braqui")) return "BRAQUITERAPIA";
  if (value.includes("ct")) return "CT";
  if (value.includes("rx")) return "RX";
  return null;
}

function foldName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g"), "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildMatchResult({ status, method, equipment = null, candidateCount, details }) {
  return {
    matchStatus: status,
    matchMethod: method,
    fieldbeatEquipmentKey: equipment?.equipment_key ?? null,
    fieldbeatEquipmentUuid: equipment?.equipment_uuid ?? null,
    fieldbeatInternalId: equipment?.internal_id ?? null,
    candidateCount,
    matchDetails: details ?? {}
  };
}

/**
 * @param {{ equipmentKey: string, clientNameCanonical: string, equipmentModel: string, serialNumber: string | null }} candidate
 * @param {{ fieldbeatEquipments: Array<object>, fieldbeatClients: Array<object>, overrides: Array<{equipmentKey: string, fieldbeatEquipmentId: string}> }} ctx
 * @returns {object} resultado de matching, listo para persistir en config.contract_equipment_matches
 */
export function matchOneEquipment(candidate, { fieldbeatEquipments, fieldbeatClients, overrides }) {
  // Nivel 1: override manual activo, nunca se crea automáticamente.
  const override = (overrides ?? []).find(o => o.equipmentKey === candidate.equipmentKey);
  if (override) {
    const overridden = fieldbeatEquipments.find(e => e.equipment_key === override.fieldbeatEquipmentId);
    if (overridden) {
      return buildMatchResult({ status: "MATCHED", method: "OVERRIDE", equipment: overridden, candidateCount: 1, details: { reason: "override activo" } });
    }
    // Override apunta a un equipment_key que ya no existe en el maestro -no
    // se autoconfirma nada, se reporta como no encontrado vía override.
    return buildMatchResult({ status: "UNMATCHED", method: "OVERRIDE", candidateCount: 0, details: { reason: "override activo pero fieldbeat_equipment_id ya no existe en el maestro" } });
  }

  // Nivel 2: sufijo de serie extraído de internal_id, exacto.
  const normalizedSerial = normalizeSerialForMatching(candidate.serialNumber);
  if (normalizedSerial) {
    const serialCandidates = fieldbeatEquipments.filter(e => {
      const extracted = extractTrailingSerial(e.internal_id);
      return extracted && normalizeSerialForMatching(extracted) === normalizedSerial;
    });

    if (serialCandidates.length === 1) {
      return buildMatchResult({ status: "MATCHED", method: "SERIAL_SUFFIX", equipment: serialCandidates[0], candidateCount: 1, details: {} });
    }
    if (serialCandidates.length > 1) {
      return buildMatchResult({
        status: "AMBIGUOUS",
        method: "SERIAL_SUFFIX",
        candidateCount: serialCandidates.length,
        details: { candidateInternalIds: serialCandidates.map(e => e.internal_id) }
      });
    }
    // 0 candidatos por serie -sigue al nivel 3, no se abandona todavía.
  }

  // Nivel 3: cliente canónico + categoría de equipo (sin sede real
  // disponible -ver hallazgo arriba). Nunca autoconfirma un match ambiguo.
  const category = classifyContractEquipmentModel(candidate.equipmentModel);
  const candidateClientKeys = new Set(
    fieldbeatClients.filter(c => foldName(c.client_name) === foldName(candidate.clientNameCanonical)).map(c => c.client_key)
  );

  const clientModelCandidates = category
    ? fieldbeatEquipments.filter(e => candidateClientKeys.has(e.client_key) && classifyFieldbeatInternalId(e.internal_id) === category)
    : [];

  if (clientModelCandidates.length === 1) {
    return buildMatchResult({ status: "MATCHED", method: "CLIENT_SITE_MODEL", equipment: clientModelCandidates[0], candidateCount: 1, details: { note: "sin precisión de sede -ver hallazgo de schema" } });
  }
  if (clientModelCandidates.length > 1) {
    return buildMatchResult({
      status: "AMBIGUOUS",
      method: "CLIENT_SITE_MODEL",
      candidateCount: clientModelCandidates.length,
      details: { candidateInternalIds: clientModelCandidates.map(e => e.internal_id), note: "sin precisión de sede -ver hallazgo de schema" }
    });
  }

  return buildMatchResult({ status: "UNMATCHED", method: "NONE", candidateCount: 0, details: {} });
}

/**
 * @param {Array<object>} candidates equipos contractuales candidatos (equipmentKey, clientNameCanonical, equipmentModel, serialNumber)
 * @param {{ fieldbeatEquipments: Array<object>, fieldbeatClients: Array<object>, overrides: Array<object> }} ctx
 * @returns {Array<object & {equipmentKey: string}>}
 */
export function matchAll(candidates, ctx) {
  return candidates.map(candidate => ({
    equipmentKey: candidate.equipmentKey,
    ...matchOneEquipment(candidate, ctx)
  }));
}

/**
 * Convierte un resultado de matching en issues -no fatal, solo
 * requires_review (ver tabla de condiciones fatales/no fatales del plan).
 * @param {{matchStatus: string}} matchResult
 * @returns {Array<{issueType: string, details: object}>}
 */
export function matchResultToIssues(matchResult) {
  if (matchResult.matchStatus === "UNMATCHED") {
    return [{ issueType: "UNMATCHED_FIELDBEAT_EQUIPMENT", details: {} }];
  }
  if (matchResult.matchStatus === "AMBIGUOUS") {
    return [{ issueType: "AMBIGUOUS_FIELDBEAT_MATCH", details: { candidateCount: matchResult.candidateCount } }];
  }
  return [];
}
