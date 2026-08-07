import { resolveContractStartDate, loadKnownContractStartDates } from "./contract-start-date-resolver.js";
import { computeVersionAction } from "./versioning.js";
import { findSuccessfulContractImport } from "./import-identity.js";
import { CONTRACT_TRANSFORM_VERSION } from "./transform-version.js";

function versionKey(equipmentKey, validFrom) {
  return JSON.stringify([equipmentKey, validFrom ?? null]);
}

/**
 * Resuelve en dos consultas batch el estado de idempotencia y versionado que
 * mostrará el dry-run. Es estrictamente de solo lectura y evita un SELECT por
 * equipo.
 */
export async function loadDryRunDatabaseState(queryable, {
  sourceSha256,
  transformVersion = CONTRACT_TRANSFORM_VERSION,
  records,
  effectiveDate,
  knownContractStartDates = loadKnownContractStartDates()
}) {
  const prior = await findSuccessfulContractImport(queryable, { sourceSha256, transformVersion });

  const equipmentKeys = [...new Set(records.map(record => record.equipmentKey))];
  const currentResult = equipmentKeys.length === 0
    ? { rows: [] }
    : await queryable.query(
      `SELECT contract_version_id, equipment_key, contract_fingerprint, valid_from
       FROM config.contract_equipment_versions
       WHERE equipment_key = ANY($1::text[]) AND is_current = true`,
      [equipmentKeys]
    );

  const currentByIdentity = new Map(
    currentResult.rows.map(row => [versionKey(row.equipment_key, row.valid_from), row])
  );
  const versionActions = new Map();
  for (const record of records) {
    const resolvedStart = resolveContractStartDate({
      equipmentKey: record.equipmentKey,
      installationMonth: record.normalizedFields.installationMonth,
      installationDatePrecision: record.normalizedFields.installationDatePrecision
    }, knownContractStartDates);
    const current = currentByIdentity.get(versionKey(record.equipmentKey, resolvedStart.validFrom)) ?? null;
    versionActions.set(
      record.equipmentKey,
      computeVersionAction(record.contractFingerprint, current, effectiveDate).action
    );
  }

  return {
    alreadyImported: {
      isDuplicate: Boolean(prior),
      priorImportId: prior?.import_id ?? null,
      transformVersion
    },
    versionActions
  };
}
