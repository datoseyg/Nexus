import { normalizeSerialForMatching, extractTrailingSerial } from "./normalize-serial.js";
// Ver comentario en normalize-client.js sobre por qué esta implementación
// vive dentro de apps/nexus-bi-app/ (Bloque 2 NEXUS V3).
import { buildContractClientNameKey } from "../../apps/nexus-bi-app/lib/contract-client-name-key.js";

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

// ETAPA 6.5.2B2 - allowlist CERRADA de prefijos de serial alfanumérico
// gobernados -nunca inferida dinámicamente. Agregar un prefijo nuevo es una
// decisión humana explícita respaldada por evidencia real (mismo criterio
// que EQUIPMENT_MODEL_TO_CATEGORY), documentada en el reporte de la etapa
// que lo agregue. "FT" confirmado contra datos reales: FT07026, FT02211,
// FT02181 (Flexitron/HDR, categoría BRAQUITERAPIA).
const GOVERNED_ALPHANUMERIC_SERIAL_PREFIXES = ["FT"];

/**
 * Extrae el TOKEN alfanumérico completo (prefijo gobernado + dígitos,
 * ceros a la izquierda preservados como caracteres literales, nunca
 * parseados como número) al final de un internal_id de FieldBeat, ej.
 * "HDR-FT07026" -> "FT07026". A diferencia de extractTrailingSerial()
 * (solo dígitos), esto exige que el prefijo gobernado aparezca INMEDIATA-
 * MENTE antes de los dígitos -"HDR-07026" (sin FT) o "HDR-FT7026" (menos
 * dígitos) NUNCA producen el mismo token que "FT07026" (§5/§6 del encargo:
 * FT07026 ≠ 07026, FT07026 ≠ FT7026).
 * @param {string | null | undefined} internalId
 * @returns {string | null}
 */
export function extractTrailingGovernedAlphanumericSerial(internalId) {
  const value = String(internalId ?? "").trim();
  for (const prefix of GOVERNED_ALPHANUMERIC_SERIAL_PREFIXES) {
    const match = value.match(new RegExp(`(${prefix}\\d{3,})\\s*$`, "i"));
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function classifyFieldbeatInternalId(internalId) {
  const value = String(internalId ?? "").toLowerCase();
  if (value.includes("linac")) return "LINAC";
  if (value.includes("braqui")) return "BRAQUITERAPIA";
  if (value.includes("ct")) return "CT";
  if (value.includes("rx")) return "RX";
  return null;
}

// Re-exportado por compatibilidad con los call sites existentes de este
// archivo y de client-identity-aliases.js -la implementación real (idéntica
// a la que vivía acá) ahora vive una sola vez en client-name-key.js, porque
// client_name_key se persiste como identidad y no puede tener dos algoritmos
// independientes.
export const foldName = buildContractClientNameKey;

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

function filterRealFieldbeatEquipments(fieldbeatEquipments) {
  // ETAPA 6.5.2B1 - excluye filas "fantasma" de processed.fieldbeat_equipments
  // (equipment_uuid NULL/'') antes de que participen como candidatas de
  // matching -mismo patrón de defecto que 6.5.2B0 (buildFieldbeatKeyByUuid),
  // en un consumidor distinto. Hallazgo empírico: 24 internal_id de la tabla
  // maestra tienen una fila real + una fila fantasma con el mismo
  // internal_id; sin este filtro, extractTrailingSerial() encuentra 2
  // "candidatos" para un único equipo físico real y el match cae a
  // AMBIGUOUS en vez de MATCHED, incluso con serial único.
  return fieldbeatEquipments.filter(e => e.equipment_uuid !== null && e.equipment_uuid !== undefined && e.equipment_uuid !== "");
}

/**
 * Nivel 1 (override) + Nivel 2 (serial exacto) únicamente -evidencia
 * "fuerte": identifica una máquina física real, nunca una categoría. El
 * override manual sigue operando sobre fieldbeatEquipments COMPLETO (no
 * filtrado), porque un override explícito puede apuntar legítimamente a
 * cualquier equipment_key existente. Devuelve null si ninguno de los 2
 * niveles resuelve algo -el candidato debe seguir al Nivel 3.
 * Reutilizado tanto por matchOneEquipment() como por
 * computeClaimedFieldbeatEquipmentKeys(), para que "qué reclamó este
 * candidato por evidencia fuerte" sea EXACTAMENTE la misma lógica en
 * ambos lugares.
 */
function resolveStrongMatch(candidate, { fieldbeatEquipments, realFieldbeatEquipments, overrides, fieldbeatClients, clientAliasIndex }) {
  const override = (overrides ?? []).find(o => o.equipmentKey === candidate.equipmentKey);
  if (override) {
    const overridden = fieldbeatEquipments.find(e => e.equipment_key === override.fieldbeatEquipmentId);
    if (overridden) {
      return { status: "MATCHED", method: "OVERRIDE", equipment: overridden, candidateCount: 1, details: { reason: "override activo" } };
    }
    return { status: "UNMATCHED", method: "OVERRIDE", candidateCount: 0, details: { reason: "override activo pero fieldbeat_equipment_id ya no existe en el maestro" } };
  }

  const normalizedSerial = normalizeSerialForMatching(candidate.serialNumber);
  if (normalizedSerial) {
    const serialCandidates = realFieldbeatEquipments.filter(e => {
      const extracted = extractTrailingSerial(e.internal_id);
      return extracted && normalizeSerialForMatching(extracted) === normalizedSerial;
    });
    if (serialCandidates.length === 1) {
      return { status: "MATCHED", method: "SERIAL_SUFFIX", equipment: serialCandidates[0], candidateCount: 1, details: {} };
    }
    if (serialCandidates.length > 1) {
      return { status: "AMBIGUOUS", method: "SERIAL_SUFFIX", candidateCount: serialCandidates.length, details: { candidateInternalIds: serialCandidates.map(e => e.internal_id) } };
    }

    // ETAPA 6.5.2B2 - Nivel 2b: serial alfanumérico gobernado (FT07026,
    // FT02211, ...). Solo se intenta si el sufijo numérico puro (arriba) no
    // resolvió nada -evita reinterpretar un serial ya cubierto por la regla
    // existente. Reutiliza match_method="SERIAL_SUFFIX" -el CHECK de
    // config.contract_equipment_matches tiene un enum cerrado que esta
    // etapa no puede tocar (fuera de alcance: constraints PostgreSQL); un
    // alfanumérico exacto es la MISMA clase de evidencia que uno numérico.
    //
    // A diferencia del sufijo numérico (que nunca verifica cliente, porque
    // un serial real es una identidad físicamente única por sí sola), esta
    // regla exige ADEMÁS cliente canónico compatible (§4 del encargo) antes
    // de confirmar -evidencia real: un candidato único por serial puede
    // pertenecer a un client_key de FieldBeat que NO es una variante ni un
    // alias gobernado del cliente contractual (caso real: FT02181 pertenece
    // a un client_key distinto de Sanatorio Alemán en FieldBeat, sin alias
    // aprobado que los una -ver reporte de ETAPA 6.5.2B2). Sin fieldbeatClients
    // disponible, esta regla nunca se evalúa (nunca asume compatibilidad
    // por defecto) -mismo criterio conservador que clientAliasIndex ausente.
    const alphanumericSerial = extractTrailingGovernedAlphanumericSerial(normalizedSerial) === normalizedSerial
      ? normalizedSerial
      : null;
    if (alphanumericSerial && fieldbeatClients) {
      const alphanumericCandidates = realFieldbeatEquipments.filter(e => extractTrailingGovernedAlphanumericSerial(e.internal_id) === alphanumericSerial);

      if (alphanumericCandidates.length > 1) {
        return { status: "AMBIGUOUS", method: "SERIAL_SUFFIX", candidateCount: alphanumericCandidates.length, details: { candidateInternalIds: alphanumericCandidates.map(e => e.internal_id) } };
      }
      if (alphanumericCandidates.length === 1) {
        const equipment = alphanumericCandidates[0];
        const resolveAlias = (name) => clientAliasIndex?.get(foldName(name)) ?? name;
        const canonicalContractClient = foldName(resolveAlias(candidate.clientNameCanonical));
        const fbClient = fieldbeatClients.find(c => c.client_key === equipment.client_key);
        const canonicalFieldbeatClient = fbClient ? foldName(resolveAlias(fbClient.client_name)) : null;

        if (canonicalFieldbeatClient === canonicalContractClient) {
          return { status: "MATCHED", method: "SERIAL_SUFFIX", equipment, candidateCount: 1, details: {} };
        }
        return {
          status: "UNMATCHED",
          method: "SERIAL_SUFFIX",
          candidateCount: 0,
          details: {
            reason: "CLIENT_MISMATCH",
            fieldbeatClientName: fbClient?.client_name ?? null,
            contractClientName: candidate.clientNameCanonical,
            note: `serial alfanumérico "${alphanumericSerial}" identifica un único equipo FieldBeat real, pero su cliente ("${fbClient?.client_name ?? "desconocido"}") no coincide con el cliente contractual ("${candidate.clientNameCanonical}") ni con ningún alias gobernado -no se autoasocia solo por serial`
          }
        };
      }
    }
  }
  return null;
}

/**
 * Regla 3 (corrección de dominio post-6.5.2B1): un serial exacto tiene
 * precedencia sobre cualquier match de categoría -una vez que un equipo
 * FieldBeat fue reclamado por CUALQUIER candidato vía evidencia fuerte
 * (Nivel 1/2), ningún otro candidato puede volver a introducirlo en el
 * Nivel 3 (cliente+categoría). Debe computarse UNA VEZ sobre la lista
 * COMPLETA de candidatos de la corrida -nunca por candidato aislado,
 * porque la contaminación ocurre PRECISAMENTE entre candidatos distintos
 * (ej. Compact SN:201110 reclama Linac-201110 por serial; sin esta
 * exclusión, Precise SN:105614 -sin candidato de serial propio- lo volvía
 * a "encontrar" en el Nivel 3 vía cliente+categoría, aunque ya pertenecía
 * a otro equipo físico distinto).
 * @param {Array<object>} candidates
 * @param {{ fieldbeatEquipments: Array<object>, overrides: Array<object>, fieldbeatClients?: Array<object>, clientAliasIndex?: Map<string, string> }} ctx fieldbeatClients/clientAliasIndex son necesarios para que la regla de serial alfanumérico gobernado (ETAPA 6.5.2B2) pueda reclamar equipos correctamente -ausentes, esa regla nunca reclama nada (comportamiento previo intacto)
 * @returns {Set<string>} equipment_key de processed.fieldbeat_equipments ya reclamados
 */
export function computeClaimedFieldbeatEquipmentKeys(candidates, { fieldbeatEquipments, overrides, fieldbeatClients, clientAliasIndex }) {
  const realFieldbeatEquipments = filterRealFieldbeatEquipments(fieldbeatEquipments);
  const claimed = new Set();
  for (const candidate of candidates) {
    const strong = resolveStrongMatch(candidate, { fieldbeatEquipments, realFieldbeatEquipments, overrides, fieldbeatClients, clientAliasIndex });
    if (strong?.status === "MATCHED" && strong.equipment) {
      claimed.add(strong.equipment.equipment_key);
    }
  }
  return claimed;
}

/**
 * Regla 1 (corrección de dominio post-6.5.2B1): cuenta, por cliente
 * canónico (resuelto vía alias) + categoría funcional gruesa (LINAC,
 * BRAQUITERAPIA, ...), cuántos candidatos contractuales DISTINTOS de la
 * corrida comparten esa combinación. "LINAC" identifica una categoría
 * (Linear Accelerator), nunca una máquina -Compact y Precise son equipos
 * físicos distintos que caen ambos en categoría LINAC. Cuando un cliente
 * tiene más de un equipo contractual de la misma categoría, cliente+
 * categoría NUNCA basta por sí sola para confirmar identidad (no hay
 * evidencia de sede disponible para desambiguar -ver hallazgo de schema).
 * @param {Array<object>} candidates
 * @param {{ clientAliasIndex?: Map<string, string> }} [ctx]
 * @returns {Map<string, number>} clave "clienteFolded|categoria" -> cantidad de candidatos
 */
export function computeClientCategorySiblingCounts(candidates, { clientAliasIndex } = {}) {
  const resolveAlias = (name) => clientAliasIndex?.get(foldName(name)) ?? name;
  const counts = new Map();
  for (const candidate of candidates) {
    const category = classifyContractEquipmentModel(candidate.equipmentModel);
    if (!category) continue;
    const key = `${foldName(resolveAlias(candidate.clientNameCanonical))}|${category}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * @param {{ equipmentKey: string, clientNameCanonical: string, equipmentModel: string, serialNumber: string | null }} candidate
 * @param {{ fieldbeatEquipments: Array<object>, fieldbeatClients: Array<object>, overrides: Array<{equipmentKey: string, fieldbeatEquipmentId: string}>, clientAliasIndex?: Map<string, string>, claimedFieldbeatEquipmentKeys?: Set<string>, clientCategorySiblingCounts?: Map<string, number> }} ctx clientAliasIndex/claimedFieldbeatEquipmentKeys/clientCategorySiblingCounts son opcionales -ausentes = comportamiento previo sin las reglas cruzadas entre candidatos (matchAll() los computa automáticamente; llamadas directas fuera de matchAll deben precomputarlos con computeClaimedFieldbeatEquipmentKeys()/computeClientCategorySiblingCounts() sobre la lista COMPLETA de candidatos de la corrida)
 * @returns {object} resultado de matching, listo para persistir en config.contract_equipment_matches
 */
export function matchOneEquipment(candidate, { fieldbeatEquipments, fieldbeatClients, overrides, clientAliasIndex, claimedFieldbeatEquipmentKeys, clientCategorySiblingCounts }) {
  const realFieldbeatEquipments = filterRealFieldbeatEquipments(fieldbeatEquipments);

  // Nivel 1 (override) + Nivel 2/2b (serial exacto, numérico o alfanumérico
  // gobernado) -evidencia fuerte, gana sobre cualquier resolución de
  // categoría (Regla 2).
  const strong = resolveStrongMatch(candidate, { fieldbeatEquipments, realFieldbeatEquipments, overrides, fieldbeatClients, clientAliasIndex });
  if (strong) {
    return buildMatchResult({ status: strong.status, method: strong.method, equipment: strong.equipment ?? null, candidateCount: strong.candidateCount, details: strong.details });
  }

  // Nivel 3: cliente canónico + categoría de equipo (sin sede real
  // disponible -ver hallazgo arriba). Nunca autoconfirma un match ambiguo.
  // ETAPA 6.5.2B1 - gobernanza de alias de cliente (data/config/contracts/
  // client-identity-aliases.json vía clientAliasIndex, opcional -ausente =
  // comportamiento anterior sin cambios): ambos lados de la comparación se
  // resuelven primero a su nombre canónico gobernado (identidad, no fuzzy)
  // antes del fold. Un alias por sí solo NUNCA produce MATCHED -sigue
  // exigiendo candidato único por cliente+categoría, igual que antes.
  const category = classifyContractEquipmentModel(candidate.equipmentModel);
  // Lookup directo sobre el Map ya construido por buildClientIdentityAliasIndex()
  // (data/config/contracts/client-identity-aliases.js) -inline, no una
  // dependencia hacia ese módulo, para no crear un ciclo de imports (ese
  // módulo ya depende de foldName exportado desde acá).
  const resolveAlias = (name) => clientAliasIndex?.get(foldName(name)) ?? name;
  const canonicalCandidateClientName = resolveAlias(candidate.clientNameCanonical);
  const candidateClientKeys = new Set(
    fieldbeatClients
      .filter(c => foldName(resolveAlias(c.client_name)) === foldName(canonicalCandidateClientName))
      .map(c => c.client_key)
  );

  const rawClientModelCandidates = category
    ? realFieldbeatEquipments.filter(e => candidateClientKeys.has(e.client_key) && classifyFieldbeatInternalId(e.internal_id) === category)
    : [];

  if (rawClientModelCandidates.length === 0) {
    return buildMatchResult({ status: "UNMATCHED", method: "NONE", candidateCount: 0, details: {} });
  }

  // Regla 1/4: cliente+categoría nunca basta por sí sola como prueba final
  // de identidad cuando el cliente tiene MÁS DE UN equipo contractual de
  // esa misma categoría (ej. Compact + Precise, ambos LINAC) -sin
  // evidencia de sede, no hay forma de saber a cuál de los dos pertenece
  // el único candidato FieldBeat encontrado. Se revisa ANTES de aplicar la
  // exclusión de reclamados (abajo) para que la colisión quede visible en
  // vez de degradarse silenciosamente a UNMATCHED.
  const siblingKey = category ? `${foldName(canonicalCandidateClientName)}|${category}` : null;
  const siblingCount = (siblingKey && clientCategorySiblingCounts?.get(siblingKey)) ?? 1;
  if (siblingCount > 1) {
    // candidateCount = siblingCount (candidatos CONTRACTUALES en disputa),
    // no rawClientModelCandidates.length (equipos FieldBeat encontrados) -
    // config.contract_equipment_matches tiene un CHECK real que exige
    // candidate_count > 1 para AMBIGUOUS; aquí puede haber exactamente 1
    // equipo FieldBeat físico pero 2+ candidatos contractuales compitiendo
    // por él, y ese es precisamente el número que hay que reportar.
    return buildMatchResult({
      status: "AMBIGUOUS",
      method: "CLIENT_SITE_MODEL",
      candidateCount: siblingCount,
      details: {
        candidateInternalIds: rawClientModelCandidates.map(e => e.internal_id),
        reason: "SIBLING_CATEGORY_COLLISION",
        note: `el cliente tiene ${siblingCount} equipos contractuales de categoría ${category} -cliente+categoría nunca basta por sí sola para desambiguar entre ellos, sin evidencia de sede`
      }
    });
  }

  // Regla 3: excluye equipos ya reclamados por OTRO candidato vía
  // evidencia fuerte (Nivel 1/2) -un serial exacto ajeno tiene precedencia,
  // este candidato no puede volver a introducir ese mismo equipo aquí.
  const claimed = claimedFieldbeatEquipmentKeys ?? new Set();
  const clientModelCandidates = rawClientModelCandidates.filter(e => !claimed.has(e.equipment_key));

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

  return buildMatchResult({ status: "UNMATCHED", method: "NONE", candidateCount: 0, details: { reason: "el único candidato por cliente+categoría ya fue reclamado por otro candidato con evidencia fuerte (serial exacto u override)" } });
}

/**
 * @param {Array<object>} candidates equipos contractuales candidatos (equipmentKey, clientNameCanonical, equipmentModel, serialNumber)
 * @param {{ fieldbeatEquipments: Array<object>, fieldbeatClients: Array<object>, overrides: Array<object>, clientAliasIndex?: Map<string, string> }} ctx
 * @returns {Array<object & {equipmentKey: string}>}
 */
export function matchAll(candidates, ctx) {
  // Computado UNA VEZ sobre TODA la lista de candidatos -ver Reglas 1 y 3
  // en computeClaimedFieldbeatEquipmentKeys()/computeClientCategorySiblingCounts().
  const claimedFieldbeatEquipmentKeys = computeClaimedFieldbeatEquipmentKeys(candidates, ctx);
  const clientCategorySiblingCounts = computeClientCategorySiblingCounts(candidates, ctx);
  return candidates.map(candidate => ({
    equipmentKey: candidate.equipmentKey,
    ...matchOneEquipment(candidate, { ...ctx, claimedFieldbeatEquipmentKeys, clientCategorySiblingCounts })
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
