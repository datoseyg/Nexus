import fs from "node:fs/promises";
import path from "node:path";
import { matchResultToIssues } from "./fieldbeat-matcher.js";

const REPORT_DIR = "data/reports/contracts";

/**
 * Arma el reporte de dry-run. Deliberadamente NUNCA incluye: texto de
 * Notas crudo, firmas personales, raw_payload, ni hashes por fila
 * (source_row_hash/contract_fingerprint individuales) -solo el
 * sourceSha256 de archivo completo, necesario para mostrar el estado de
 * idempotencia.
 * @param {object} input
 * @returns {object}
 */
export function buildDryRunReport({
  sourceFile,
  sourceSha256,
  sourceSheet,
  rows,
  ignoredRows,
  erroredRows,
  records,
  matchSource,
  matches,
  alreadyImported,
  dbPeekAvailable
}) {
  const matchesByEquipmentKey = new Map((matches ?? []).map(m => [m.equipmentKey, m]));
  const issues = records.flatMap(r => {
    const recordIssues = r.issues.map(i => ({ entityId: r.equipmentKey, ...i }));
    const matchResult = matchesByEquipmentKey.get(r.equipmentKey);
    const matchIssues = matchResult ? matchResultToIssues(matchResult).map(i => ({ entityId: r.equipmentKey, ...i })) : [];
    return [...recordIssues, ...matchIssues];
  });
  const issuesByType = {};
  for (const issue of issues) {
    issuesByType[issue.issueType] = (issuesByType[issue.issueType] ?? 0) + 1;
  }

  const canonicalByName = new Map();
  for (const r of records) {
    const canonical = r.normalizedFields.clientNameCanonical;
    if (!canonicalByName.has(canonical)) canonicalByName.set(canonical, new Set());
    canonicalByName.get(canonical).add(r.clientNameRaw);
  }

  const equipmentKeyCounts = {};
  for (const r of records) equipmentKeyCounts[r.equipmentKey] = (equipmentKeyCounts[r.equipmentKey] ?? 0) + 1;
  const duplicateEquipmentKeysWithinFile = Object.entries(equipmentKeyCounts)
    .filter(([, count]) => count > 1)
    .map(([equipmentKey, count]) => ({ equipmentKey, count }));

  const fieldbeatMatches = {
    matched: (matches ?? []).filter(m => m.matchStatus === "MATCHED").length,
    unmatched: (matches ?? []).filter(m => m.matchStatus === "UNMATCHED").length,
    ambiguous: (matches ?? []).filter(m => m.matchStatus === "AMBIGUOUS").length,
    details: (matches ?? []).map(m => ({
      equipmentKey: m.equipmentKey,
      status: m.matchStatus,
      method: m.matchMethod,
      candidateCount: m.candidateCount,
      fieldbeatEquipmentKey: m.fieldbeatEquipmentKey,
      fieldbeatInternalId: m.fieldbeatInternalId
    }))
  };

  return {
    importMode: "dry-run",
    sourceFile,
    sourceSha256,
    sourceSheet: sourceSheet ?? null,
    dbPeekAvailable: Boolean(dbPeekAvailable),
    alreadyImported: alreadyImported ?? { isDuplicate: "unknown", priorImportId: null },
    rows: {
      read: rows.length,
      accepted: records.length,
      ignored: ignoredRows.length,
      errored: erroredRows.length
    },
    ignoredRows: ignoredRows.map(r => ({ sourceRowNumber: r.sourceRowNumber, reason: r.reason })),
    erroredRows: erroredRows.map(r => ({ sourceRowNumber: r.sourceRowNumber, reason: r.reason })),
    equipmentRecords: records.map(r => ({
      equipmentKey: r.equipmentKey,
      isProvisionalKey: r.isProvisionalKey,
      clientNameCanonical: r.normalizedFields.clientNameCanonical,
      equipmentModel: r.normalizedFields.equipmentModel,
      serialNumber: r.normalizedFields.serialNumber,
      contractStatusCode: r.normalizedFields.contractStatusCode,
      requiresReview: r.requiresReview,
      normalizationStatus: r.normalizationStatus,
      versionAction: "unknown"
    })),
    serviceWindows: records.flatMap(r =>
      r.serviceWindowRows.map(w => ({ equipmentKey: r.equipmentKey, ...w }))
    ),
    issues,
    issuesByType,
    canonicalClients: Array.from(canonicalByName.entries()).map(([clientNameCanonical, variants]) => ({
      clientNameCanonical,
      rawVariantsSeen: Array.from(variants)
    })),
    equipmentKeys: {
      total: records.length,
      provisional: records.filter(r => r.isProvisionalKey).length
    },
    duplicateEquipmentKeysWithinFile,
    matchSource: matchSource ?? "CSV",
    fieldbeatMatches,
    possiblyExpiredWarranties: records
      .filter(r => r.issues.some(i => i.issueType === "WARRANTY_END_DATE_PASSED"))
      .map(r => ({ equipmentKey: r.equipmentKey, warrantyEndDate: r.normalizedFields.warrantyEndDate })),
    unparseableSchedules: records
      .filter(r => r.parseStatus === "REVIEW_REQUIRED")
      .map(r => ({ equipmentKey: r.equipmentKey, attentionScheduleRaw: r.attentionScheduleRaw, coverageType: r.coverageType })),
    generatedAt: new Date().toISOString()
  };
}

/**
 * @param {object} report
 * @returns {Promise<string>} ruta del archivo escrito
 */
export async function writeDryRunReport(report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const shaPrefix = report.sourceSha256.slice(0, 12);
  const filePath = path.join(REPORT_DIR, `contract_import_dry_run_${shaPrefix}.json`);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}
