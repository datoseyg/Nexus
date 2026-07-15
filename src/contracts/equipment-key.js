import { sha256Hex } from "./hash.js";
import { normalizeSerialForMatching } from "./normalize-serial.js";

/**
 * Clave de equipo estable a través de reimportaciones. Prioriza el serial
 * normalizado (namespaced "SN:...", estable porque el serial de un equipo
 * físico no cambia). Si falta el serial, cae a una clave PROVISIONAL
 * derivada SOLO de los campos de identidad estables (cliente canónico +
 * sede + modelo) -nunca del hash de la fila completa, porque ese hash
 * cambia con cualquier campo contractual (estado, horario, etc.) y
 * rompería el versionado (el mismo equipo dejaría de reconocerse como
 * "el mismo equipment_key" en la siguiente importación).
 * @param {{ clientNameCanonical: string, siteAbbreviation: string | null, equipmentModel: string, serialNumber: string | null }} input
 * @returns {{ equipmentKey: string, isProvisional: boolean }}
 */
export function buildEquipmentKey({ clientNameCanonical, siteAbbreviation, equipmentModel, serialNumber }) {
  const normalizedSerial = normalizeSerialForMatching(serialNumber);

  if (normalizedSerial) {
    return { equipmentKey: `SN:${normalizedSerial}`, isProvisional: false };
  }

  const identityString = [clientNameCanonical, siteAbbreviation, equipmentModel]
    .map(v => String(v ?? "").trim().toUpperCase())
    .join("|");
  const identityHash = sha256Hex(identityString).slice(0, 16);

  return { equipmentKey: `PROV:${identityHash}`, isProvisional: true };
}
