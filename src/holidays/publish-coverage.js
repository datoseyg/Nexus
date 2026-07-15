// Wrapper delgado sobre config.publish_holiday_coverage() (definida en
// sql/080_holiday_calendar.sql, ETAPA 6.6B0) -nunca hace UPDATE directo
// sobre config.holiday_calendar_coverage, para no evadir el advisory lock,
// la revisión de solapamiento, ni la transición DRAFT->VALIDATED /
// VALIDATED->SUPERSEDED que esa función ya encapsula.

/**
 * @param {import("pg").Pool} pool
 * @param {{ coverageId: number, supersedeCoverageId?: number|null }} args
 * @returns {Promise<{ publishedCoverageId: number }>}
 */
export async function publishCoverage(pool, { coverageId, supersedeCoverageId = null }) {
  const coverageRow = await pool.query(
    `SELECT jurisdiction, coverage_range, source_import_id, coverage_status FROM config.holiday_calendar_coverage WHERE coverage_id = $1`,
    [coverageId]
  );
  if (coverageRow.rows.length === 0) {
    throw new Error(`No existe config.holiday_calendar_coverage.coverage_id=${coverageId}.`);
  }
  const row = coverageRow.rows[0];
  if (row.coverage_status !== "DRAFT") {
    throw new Error(`coverage_id=${coverageId} tiene coverage_status="${row.coverage_status}" -solo se puede publicar una cobertura DRAFT.`);
  }

  // Limitación conocida y documentada (no se modifica sql/080, congelado):
  // config.publish_holiday_coverage() SIEMPRE inserta una fila NUEVA y la
  // promueve a VALIDATED -nunca "adopta"/promueve un DRAFT ya existente
  // (como el que applyBundle() creó). Se reconcilia acá: se llama a la
  // función con los mismos datos del DRAFT original, y ese DRAFT original
  // se retira marcándolo SUPERSEDED hacia la fila realmente publicada -se
  // conserva el historial completo (nunca un DELETE silencioso). Una mejora
  // futura sería que la función aceptara un id de DRAFT a promover
  // directamente; eso requeriría tocar sql/080 y queda fuera de alcance de
  // 6.6B1.
  const result = await pool.query(
    `SELECT config.publish_holiday_coverage($1, $2, $3, $4) AS coverage_id`,
    [row.jurisdiction, row.coverage_range, row.source_import_id, supersedeCoverageId]
  );
  const publishedCoverageId = Number(result.rows[0].coverage_id);

  if (publishedCoverageId !== Number(coverageId)) {
    await pool.query(
      `UPDATE config.holiday_calendar_coverage
       SET coverage_status = 'SUPERSEDED', superseded_by_coverage_id = $1
       WHERE coverage_id = $2 AND coverage_status = 'DRAFT'`,
      [publishedCoverageId, coverageId]
    );
  }

  return { publishedCoverageId };
}
