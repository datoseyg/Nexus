import { STATEMENT_TIMEOUT_MS } from "./db-client.js";

/**
 * Registra import_status=FAILED en una operación SEPARADA de la transacción
 * ya abortada -mismo patrón que src/contracts/db-writer.js. Nunca lanza.
 */
async function recordFailedImportStatus(queryable, meta, error) {
  try {
    await queryable.query(
      `INSERT INTO config.holiday_import_runs
         (source_filename, source_sha256, jurisdiction, rows_read, rows_accepted, rows_ignored, rows_errored, import_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'FAILED',$8)`,
      [
        meta.sourceFilename,
        meta.sourceSha256,
        meta.jurisdiction,
        meta.rowsRead,
        meta.rowsAccepted,
        meta.rowsIgnored,
        meta.rowsErrored,
        JSON.stringify({ argv: process.argv.slice(2), error: String(error?.message ?? error) })
      ]
    );
  } catch (recordError) {
    console.error("No se pudo registrar import_status=FAILED (la transacción original ya fue revertida):", recordError);
  }
}

/**
 * @param {import("pg").PoolClient|import("pg").Pool} queryable
 * @param {string} sha256
 * @returns {Promise<{ alreadyImported: boolean, importId: string|null }>}
 */
export async function checkAlreadyImported(queryable, sha256) {
  const result = await queryable.query(
    `SELECT import_id FROM config.holiday_import_runs WHERE source_sha256 = $1 AND import_status = 'SUCCESS'`,
    [sha256]
  );
  return result.rows.length > 0 ? { alreadyImported: true, importId: result.rows[0].import_id } : { alreadyImported: false, importId: null };
}

/**
 * Aplica un bundle YA VALIDADO (bundle-validator.js) en una única
 * transacción: import_run SUCCESS -> holiday_calendar_entries -> cobertura
 * DRAFT (nunca VALIDATED automáticamente -eso requiere publish-coverage.js,
 * una operación separada y explícita). Idempotente por SHA-256 vía el
 * índice único parcial de sql/080 (holiday_import_runs_success_sha_uidx).
 * @param {{ pool: import("pg").Pool, filename: string, sha256: string, bundle: object, resolvedEvents: object[] }} args
 * @returns {Promise<{ alreadyImported: boolean, importId: string|null, coverageId: number|null, rowsAccepted: number }>}
 */
export async function applyBundle({ pool, filename, sha256, bundle, resolvedEvents }) {
  const client = await pool.connect();
  const meta = {
    sourceFilename: filename,
    sourceSha256: sha256,
    jurisdiction: bundle.jurisdiction,
    rowsRead: resolvedEvents.length,
    rowsAccepted: resolvedEvents.length,
    rowsIgnored: 0,
    rowsErrored: 0
  };

  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    // Advisory lock transaccional por SHA -evita que 2 procesos concurrentes
    // importen el mismo archivo a la vez (mismo patrón que contracts).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [sha256]);

    const already = await client.query(
      `SELECT import_id FROM config.holiday_import_runs WHERE source_sha256 = $1 AND import_status = 'SUCCESS'`,
      [sha256]
    );
    if (already.rows.length > 0) {
      await client.query("COMMIT");
      return { alreadyImported: true, importId: already.rows[0].import_id, coverageId: null, rowsAccepted: 0 };
    }

    const importInsert = await client.query(
      `INSERT INTO config.holiday_import_runs
         (source_filename, source_sha256, jurisdiction, rows_read, rows_accepted, rows_ignored, rows_errored, import_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'SUCCESS',$8)
       RETURNING import_id`,
      [filename, sha256, bundle.jurisdiction, meta.rowsRead, meta.rowsAccepted, meta.rowsIgnored, meta.rowsErrored, JSON.stringify({ sources: bundle.sources })]
    );
    const importId = importInsert.rows[0].import_id;

    for (const event of resolvedEvents) {
      await client.query(
        `INSERT INTO config.holiday_calendar_entries
           (local_date, jurisdiction, source_event_key, holiday_name, holiday_type, is_irrenunciable, source_import_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [event.local_date, bundle.jurisdiction, event.source_event_key, event.holiday_name, event.holiday_type, event.is_irrenunciable ?? null, importId]
      );
    }

    const coverageInsert = await client.query(
      `INSERT INTO config.holiday_calendar_coverage (jurisdiction, coverage_range, coverage_status, source_import_id)
       VALUES ($1, daterange($2, $3), 'DRAFT', $4)
       RETURNING coverage_id`,
      [bundle.jurisdiction, bundle.coverage_start, bundle.coverage_end_exclusive, importId]
    );

    await client.query("COMMIT");
    return { alreadyImported: false, importId, coverageId: coverageInsert.rows[0].coverage_id, rowsAccepted: meta.rowsAccepted };
  } catch (error) {
    await client.query("ROLLBACK");
    await recordFailedImportStatus(client, meta, error);
    throw error;
  } finally {
    client.release();
  }
}
