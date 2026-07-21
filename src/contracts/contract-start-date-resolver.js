// ETAPA 6.5.1 - Resuelve valid_from real de una versión contractual, en
// reemplazo de la corrección previa (effective_date de la corrida de
// importación persistido directamente como valid_from - ver diagnóstico).
// Orden de resolución, nunca inventa una fecha:
//   1. Fecha de negocio conocida y confirmada (data/config/contracts/
//      known-contract-start-dates.json) -> EXPLICIT_KNOWN_DATE, is_inferred=false.
//   2. installation_month/installation_date_precision del CSV (cuando no
//      hay fecha conocida) -> INSTALLATION_DATE_INFERRED, is_inferred=true.
//      NUNCA se asume equivalente a la fecha real de inicio del contrato de
//      servicio (pueden diferir por años - ver casos documentados en el
//      JSON de fechas conocidas).
//   3. Si ninguna fuente resuelve -> UNRESOLVED, valid_from=NULL. Nunca se
//      asigna una fecha artificial (regla 7 de ETAPA 6.5.1).
import { readFileSync } from "node:fs";

/**
 * @param {string} [path]
 * @returns {Map<string, object>} equipment_key -> entrada del JSON de fechas conocidas
 */
export function loadKnownContractStartDates(path = "data/config/contracts/known-contract-start-dates.json") {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return new Map(raw.entries.map(e => [e.equipment_key, e]));
}

/**
 * @param {{ equipmentKey: string, installationMonth: string|null, installationDatePrecision: string|null }} input
 * @param {Map<string, object>} knownDatesByEquipmentKey resultado de loadKnownContractStartDates()
 * @returns {{
 *   validFrom: string|null,
 *   validFromIsInferred: boolean|null,
 *   validFromBasis: 'EXPLICIT_KNOWN_DATE'|'INSTALLATION_DATE_INFERRED'|'UNRESOLVED',
 *   validFromPrecision: 'DAY'|'MONTH'|'YEAR'|'UNKNOWN',
 *   validFromSourceField: string|null,
 *   validFromSourceValueRaw: string|null
 * }}
 */
export function resolveContractStartDate({ equipmentKey, installationMonth, installationDatePrecision }, knownDatesByEquipmentKey) {
  const known = knownDatesByEquipmentKey.get(equipmentKey);
  if (known) {
    return {
      validFrom: known.valid_from,
      validFromIsInferred: false,
      validFromBasis: "EXPLICIT_KNOWN_DATE",
      validFromPrecision: known.valid_from_precision,
      validFromSourceField: known.source_field,
      validFromSourceValueRaw: known.source_value_raw
    };
  }

  if (installationDatePrecision && installationDatePrecision !== "UNKNOWN" && installationMonth) {
    return {
      validFrom: installationMonth,
      validFromIsInferred: true,
      validFromBasis: "INSTALLATION_DATE_INFERRED",
      validFromPrecision: installationDatePrecision,
      validFromSourceField: "installation_month",
      validFromSourceValueRaw: installationMonth
    };
  }

  return {
    validFrom: null,
    validFromIsInferred: null,
    validFromBasis: "UNRESOLVED",
    validFromPrecision: "UNKNOWN",
    validFromSourceField: null,
    validFromSourceValueRaw: null
  };
}
