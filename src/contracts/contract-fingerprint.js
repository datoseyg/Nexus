import { sha256Hex } from "./hash.js";

// Orden fijo de días para que la serialización de ventanas sea determinista
// sin importar el orden en que schedule-parser.js las generó.
const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function canonicalizeWindows(serviceWindowRows) {
  return [...(serviceWindowRows ?? [])]
    .sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek))
    .map(w => ({
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      allDay: w.allDay,
      includesHolidays: w.includesHolidays
    }));
}

/**
 * Hash canónico de los campos contractuales NORMALIZADOS (nunca los raw) +
 * ventanas de servicio generadas + fecha de garantía normalizada. Excluye
 * deliberadamente: firmas personales, espacios, columnas auxiliares/
 * "Variables(no considerar para analisis)", y cualquier texto de Notas sin
 * efecto analítico -por eso un cambio puramente cosmético en el CSV nunca
 * dispara una versión contractual nueva (solo compara los campos que
 * realmente importan para el análisis).
 * @param {object} normalizedFields campos normalizados de contract_equipment_versions (sin ids/hashes/timestamps)
 * @param {Array<object>} serviceWindowRows
 * @returns {string}
 */
export function computeContractFingerprint(normalizedFields, serviceWindowRows) {
  const canonical = {
    clientNameCanonical: normalizedFields.clientNameCanonical,
    siteAbbreviation: normalizedFields.siteAbbreviation,
    equipmentModel: normalizedFields.equipmentModel,
    serialNumber: normalizedFields.serialNumber,
    installationMonth: normalizedFields.installationMonth,
    installationDatePrecision: normalizedFields.installationDatePrecision,
    contractStatusCode: normalizedFields.contractStatusCode,
    spaTierCode: normalizedFields.spaTierCode,
    weekdayService: normalizedFields.weekdayService,
    weekendService: normalizedFields.weekendService,
    supportModeCode: normalizedFields.supportModeCode,
    partsCoverageCode: normalizedFields.partsCoverageCode,
    hwRefreshCode: normalizedFields.hwRefreshCode,
    updatesCode: normalizedFields.updatesCode,
    upgradesCode: normalizedFields.upgradesCode,
    preventiveMaintenanceMin: normalizedFields.preventiveMaintenanceMin,
    preventiveMaintenanceMax: normalizedFields.preventiveMaintenanceMax,
    preventiveMaintenanceRule: normalizedFields.preventiveMaintenanceRule,
    warrantyEndDate: normalizedFields.warrantyEndDate,
    serviceWindows: canonicalizeWindows(serviceWindowRows)
  };

  return sha256Hex(JSON.stringify(canonical));
}
