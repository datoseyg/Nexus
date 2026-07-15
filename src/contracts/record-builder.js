import { COLUMN } from "./field-map.js";
import { sourceRowHash as computeSourceRowHash } from "./hash.js";
import { parseInstallationDate } from "./normalize-install-date.js";
import {
  normalizeContractStatus,
  normalizeSpaTier,
  normalizeSupportMode,
  normalizePartsCoverage,
  normalizeHwRefresh,
  normalizeUpdates,
  normalizeUpgrades
} from "./normalize-vocab-fields.js";
import { parsePreventiveMaintenance } from "./normalize-preventive-maintenance.js";
import { parseAttentionSchedule } from "./schedule-parser.js";
import { parseNotes } from "./notes-parser.js";
import { buildEquipmentKey } from "./equipment-key.js";
import { computeContractFingerprint } from "./contract-fingerprint.js";
import { createIssueCollector } from "./issue-collector.js";

function parseSiNo(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "sí" || value === "si") return true;
  if (value === "no") return false;
  return null;
}

/**
 * Orquesta una fila de equipo ya clasificada en un registro candidato
 * completo: normaliza todos los campos, parsea horario y notas, construye
 * la clave de equipo y el fingerprint, y junta todos los issues.
 * @param {{ row: string[], sourceRowNumber: number }} classifiedRow
 * @param {string} effectiveDate ISO YYYY-MM-DD
 * @param {{ normalize: (raw: string) => object }} clientNameNormalizer instancia compartida de toda la corrida (createClientNameNormalizer())
 * @returns {object} registro candidato
 */
export function buildEquipmentRecord(classifiedRow, effectiveDate, clientNameNormalizer) {
  const { row, sourceRowNumber } = classifiedRow;
  const issues = createIssueCollector();

  const client = clientNameNormalizer.normalize(row[COLUMN.CLIENTE]);
  issues.addAll(client.issues);

  const siteAbbreviation = String(row[COLUMN.ABREVIACION] ?? "").trim() || null;
  const equipmentModel = String(row[COLUMN.EQUIPO] ?? "").trim();
  const serialNumberRaw = String(row[COLUMN.SERIE] ?? "").trim() || null;

  if (!serialNumberRaw) {
    issues.addAll([{ issueType: "MISSING_SERIAL_NUMBER", details: { equipmentModel, client: client.clientNameCanonical } }]);
  }

  const installDate = parseInstallationDate(row[COLUMN.ANIO_INSTALACION]);
  issues.addAll(installDate.issues);

  const contractStatus = normalizeContractStatus(row[COLUMN.ESTADO_CONTRATO]);
  issues.addAll(contractStatus.issues);
  if (!contractStatus.raw) {
    issues.addAll([{ issueType: "MISSING_CONTRACT_STATUS", details: {} }]);
  }

  const spaTier = normalizeSpaTier(row[COLUMN.SPA_ELEKTA]);
  issues.addAll(spaTier.issues);

  const weekdayService = parseSiNo(row[COLUMN.LUN_VIE]);
  const weekendService = parseSiNo(row[COLUMN.SAB_DOM]);

  const supportMode = normalizeSupportMode(row[COLUMN.SOPORTE_ELEKTA]);
  issues.addAll(supportMode.issues);

  const attentionScheduleRaw = String(row[COLUMN.HORARIOS_ATENCION] ?? "").trim() || null;
  const schedule = parseAttentionSchedule({ attentionScheduleRaw });
  issues.addAll(schedule.issues);

  const partsCoverage = normalizePartsCoverage(row[COLUMN.SITUACION_REPUESTOS]);
  issues.addAll(partsCoverage.issues);

  const hwRefresh = normalizeHwRefresh(row[COLUMN.HW_REFRESH]);
  issues.addAll(hwRefresh.issues);
  const updates = normalizeUpdates(row[COLUMN.UPDATES]);
  issues.addAll(updates.issues);
  const upgrades = normalizeUpgrades(row[COLUMN.UPGRADES]);
  issues.addAll(upgrades.issues);

  const preventiveMaintenance = parsePreventiveMaintenance(row[COLUMN.Q_MANT_PREV_ANIO]);
  issues.addAll(preventiveMaintenance.issues);

  const notesRaw = String(row[COLUMN.NOTAS] ?? "").trim() || null;
  const notes = parseNotes(notesRaw, effectiveDate);
  issues.addAll(notes.issues);

  if (contractStatus.code === "DEINSTALLED") {
    // spaTier.code !== "UNKNOWN" (no spaTier.raw truthy): en este dataset
    // real, dos filas desinstaladas repiten el mismo texto de estado
    // ("Desintalado"/"Equipo Desinstalado") también en la columna SPA -eso
    // no es información de cobertura real, solo un eco del estado. Un
    // spa_tier_code mapeado de verdad (GOLD/SILVER/etc.) sí es señal real.
    const hasCoverageData =
      spaTier.code !== "UNKNOWN" ||
      hwRefresh.raw === "Sí" ||
      updates.raw === "Sí" ||
      upgrades.raw === "Sí" ||
      (schedule.coverageType !== "UNKNOWN" && schedule.coverageType !== "NOT_APPLICABLE" && schedule.parseStatus === "OK");
    if (hasCoverageData) {
      issues.addAll([{ issueType: "DEINSTALLED_WITH_COVERAGE_DATA", details: { equipmentModel, client: client.clientNameCanonical } }]);
    }
  }

  const { equipmentKey, isProvisional } = buildEquipmentKey({
    clientNameCanonical: client.clientNameCanonical,
    siteAbbreviation,
    equipmentModel,
    serialNumber: serialNumberRaw
  });

  const normalizedFields = {
    clientNameCanonical: client.clientNameCanonical,
    siteAbbreviation,
    equipmentModel,
    serialNumber: serialNumberRaw,
    installationMonth: installDate.installationMonth,
    installationDatePrecision: installDate.installationDatePrecision,
    contractStatusCode: contractStatus.code,
    spaTierCode: spaTier.code,
    weekdayService,
    weekendService,
    supportModeCode: supportMode.code,
    partsCoverageCode: partsCoverage.code,
    hwRefreshCode: hwRefresh.code,
    updatesCode: updates.code,
    upgradesCode: upgrades.code,
    preventiveMaintenanceMin: preventiveMaintenance.min,
    preventiveMaintenanceMax: preventiveMaintenance.max,
    preventiveMaintenanceRule: preventiveMaintenance.rule,
    warrantyEndDate: notes.warrantyEndDate
  };

  const contractFingerprint = computeContractFingerprint(normalizedFields, schedule.serviceWindowRows);
  const rowHash = computeSourceRowHash(row);

  return {
    sourceRowNumber,
    sourceRowHash: rowHash,
    equipmentKey,
    isProvisionalKey: isProvisional,
    clientNameRaw: client.clientNameRaw,
    contractStatusRaw: contractStatus.raw,
    spaRaw: spaTier.raw,
    supportModeRaw: supportMode.raw,
    partsCoverageRaw: partsCoverage.raw,
    attentionScheduleRaw,
    warrantyEndDateSource: notes.warrantyEndDateSource,
    coverageType: schedule.coverageType,
    coverageCondition: schedule.coverageCondition,
    parseStatus: schedule.parseStatus,
    serviceWindowRows: schedule.serviceWindowRows,
    contractFingerprint,
    normalizedFields,
    issues: issues.list(),
    requiresReview: issues.requiresReview(),
    normalizationStatus: issues.requiresReview() ? "NEEDS_REVIEW" : "OK"
  };
}
