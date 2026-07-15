import fs from "node:fs/promises";
import path from "node:path";

const REPORT_DIR = "data/reports/holidays";

/**
 * Arma el reporte de dry-run -nunca escribe nada en la base, solo lee (best
 * effort) si el archivo ya fue importado. Nunca incluye datos de clientes;
 * los bundles de feriados son públicos por diseño.
 * @param {object} input
 * @returns {object}
 */
export function buildDryRunReport({ filePath, sha256, bundle, validation, alreadyImported, dbPeekAvailable }) {
  const events = validation.resolvedEvents;
  const countsByType = {};
  for (const e of events) countsByType[e.holiday_type] = (countsByType[e.holiday_type] ?? 0) + 1;

  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.local_date)) byDate.set(e.local_date, []);
    byDate.get(e.local_date).push(e.source_event_key);
  }
  const coincidentDates = Array.from(byDate.entries())
    .filter(([, keys]) => keys.length > 1)
    .map(([localDate, keys]) => ({ localDate, sourceEventKeys: keys }));

  return {
    importMode: "dry-run",
    sourceFile: filePath,
    sourceSha256: sha256,
    jurisdiction: bundle?.jurisdiction ?? null,
    dbPeekAvailable: Boolean(dbPeekAvailable),
    alreadyImported: alreadyImported ?? { isDuplicate: "unknown", priorImportId: null },
    coverage: {
      start: bundle?.coverage_start ?? null,
      endExclusive: bundle?.coverage_end_exclusive ?? null
    },
    rows: {
      read: events.length,
      accepted: validation.ok ? events.length : 0,
      ignored: 0,
      errored: validation.ok ? 0 : events.length
    },
    countsByType,
    coincidentDates,
    errors: validation.errors,
    warnings: validation.warnings,
    sources: (bundle?.sources ?? []).map(s => ({ sourceId: s.source_id, authority: s.authority, title: s.title, url: s.url })),
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
  const filePath = path.join(REPORT_DIR, `holiday_import_dry_run_${shaPrefix}.json`);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}
