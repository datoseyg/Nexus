import path from "node:path";
import { randomUUID } from "node:crypto";
import { createPool, getConnectionString, STATEMENT_TIMEOUT_MS } from "./db-client.js";
import { assertWriteConfirmed } from "../lib/db-safety.js";
import { readSourceCsvRaw } from "./csv-source.js";
import { classifyRows } from "./row-classifier.js";
import { buildEquipmentRecord } from "./record-builder.js";
import { createClientNameNormalizer } from "./normalize-client.js";
import { matchOneEquipment, matchResultToIssues, computeClaimedFieldbeatEquipmentKeys, computeClientCategorySiblingCounts } from "./fieldbeat-matcher.js";
import { computeVersionAction } from "./versioning.js";
import { COLUMN } from "./field-map.js";
import { sourceRowHash } from "./hash.js";
import { loadKnownContractStartDates, resolveContractStartDate } from "./contract-start-date-resolver.js";
import { loadClientIdentityAliases, buildClientIdentityAliasIndex } from "./client-identity-aliases.js";

function extractSheetNameFromFilename(filePath) {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const match = base.match(/ - ([^-]+)\.csv$/i);
  return match ? match[1].trim() : null;
}

/**
 * Registra import_status=FAILED mediante una operación SEPARADA de la
 * transacción ya abortada -una sentencia nueva e independiente después del
 * ROLLBACK, nunca dentro de él. Recibe un "queryable" (pool o client) con
 * `.query()`: si la transacción ya se abrió, se le pasa el MISMO client
 * (ya liberado el ROLLBACK, cualquier sentencia siguiente es una unidad de
 * trabajo nueva y separada) -pasar `pool` en ese punto haría deadlock con
 * `max:1`, porque el client seguiría retenido hasta el `finally`. Si la
 * transacción nunca se abrió (falla antes de `pool.connect()`), se le pasa
 * `pool` directamente. Nunca lanza -si esto mismo falla, se loguea, no se
 * enmascara el error original.
 */
async function recordFailedImportStatus(queryable, meta, error) {
  try {
    await queryable.query(
      `INSERT INTO config.contract_import_runs
         (source_filename, source_sha256, source_sheet, effective_date, rows_read, rows_accepted, rows_ignored, rows_errored, import_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'FAILED',$9)`,
      [
        meta.sourceFilename,
        meta.sourceSha256,
        meta.sourceSheet,
        meta.effectiveDate,
        meta.rowsRead,
        meta.rowsAccepted,
        meta.rowsIgnored,
        meta.rowsErrored,
        JSON.stringify({ argv: process.argv.slice(2), error: String(error?.message ?? error) })
      ]
    );
  } catch (recordError) {
    console.error("No se pudo registrar el import_status=FAILED (la transacción original ya fue revertida):", recordError);
  }
}

function buildVersionInsertParams(record, resolvedStart, ctx) {
  const f = record.normalizedFields;
  return [
    record.equipmentKey,
    f.clientNameCanonical,
    record.clientNameRaw,
    f.siteAbbreviation,
    f.equipmentModel,
    f.serialNumber,
    f.installationMonth,
    f.installationDatePrecision,
    f.contractStatusCode,
    record.contractStatusRaw,
    f.spaTierCode,
    record.spaRaw,
    f.weekdayService,
    f.weekendService,
    f.supportModeCode,
    record.supportModeRaw,
    record.attentionScheduleRaw,
    f.partsCoverageCode,
    record.partsCoverageRaw,
    f.hwRefreshCode,
    f.updatesCode,
    f.upgradesCode,
    f.preventiveMaintenanceMin,
    f.preventiveMaintenanceMax,
    f.preventiveMaintenanceRule,
    f.warrantyEndDate,
    record.warrantyEndDateSource,
    resolvedStart.validFrom, // $28
    resolvedStart.validFromIsInferred, // $29
    resolvedStart.validFromBasis, // $30
    resolvedStart.validFromPrecision, // $31
    resolvedStart.validFromSourceField, // $32
    resolvedStart.validFromSourceValueRaw, // $33
    record.requiresReview, // $34
    record.normalizationStatus, // $35
    ctx.importId, // source_import_id ($36)
    record.sourceRowNumber, // $37
    record.sourceRowHash, // $38
    record.contractFingerprint // $39
  ];
}

const VERSION_INSERT_SQL = `
  INSERT INTO config.contract_equipment_versions (
    equipment_key, client_name_canonical, client_name_raw, site_abbreviation, equipment_model, serial_number,
    installation_month, installation_date_precision,
    contract_status_code, contract_status_raw, spa_tier_code, spa_raw,
    weekday_service, weekend_service, support_mode_code, support_mode_raw, attention_schedule_raw,
    parts_coverage_code, parts_coverage_raw, hw_refresh_code, updates_code, upgrades_code,
    preventive_maintenance_min, preventive_maintenance_max, preventive_maintenance_rule,
    warranty_end_date, warranty_end_date_source,
    valid_from, valid_from_is_inferred, valid_from_basis, valid_from_precision, valid_from_source_field, valid_from_source_value_raw,
    valid_to, is_current, requires_review, normalization_status,
    source_import_id, source_row_number, source_row_hash, contract_fingerprint
  ) VALUES (
    $1,$2,$3,$4,$5,$6, $7,$8, $9,$10,$11,$12, $13,$14,$15,$16,$17, $18,$19,$20,$21,$22,
    $23,$24,$25, $26,$27, $28,$29,$30,$31,$32,$33, NULL, true, $34, $35, $36,$37,$38,$39
  ) RETURNING contract_version_id
`;

/**
 * Ejecuta la importación --apply completa: atómica por corrida (ninguna
 * condición fatal deja una corrida SUCCESS parcial). Único PoolClient para
 * toda la transacción; el matcher consulta obligatoriamente processed.* de
 * la misma conexión (nunca CSV local).
 * @param {{ file: string, effectiveDate: string }} args
 */
export async function applyContracts(args) {
  // ETAPA SAFETY-1 - Caso G: esta función queda protegida sin importar
  // quién la llame (CLI vía import-contracts.js, o un test/script que la
  // invoque directamente, como hace test/contracts/db-writer.integration.test.js).
  // Evalúa el destino ANTES de crear el Pool -ninguna sentencia se ejecuta
  // si el target no está confirmado.
  const connectionString = getConnectionString();
  assertWriteConfirmed(connectionString, { environment: process.env.NODE_ENV ?? "development" });

  const pool = createPool({ applicationName: `contracts-apply:${randomUUID().slice(0, 8)}` });
  const sourceFilename = path.basename(args.file);
  const sourceSheet = extractSheetNameFromFilename(args.file);

  let csvResult;
  try {
    csvResult = await readSourceCsvRaw(args.file);
  } catch (error) {
    // Header/CSV estructuralmente inválido -FATAL, ni siquiera hay
    // sourceSha256 confiable para registrar el intento; se relanza tal cual.
    await pool.end();
    throw error;
  }

  const { sourceSha256, dataRows } = csvResult;
  const { equipmentRows, ignoredRows, erroredRows } = classifyRows(dataRows);

  const meta = {
    sourceFilename,
    sourceSha256,
    sourceSheet,
    effectiveDate: args.effectiveDate,
    rowsRead: dataRows.length,
    rowsAccepted: equipmentRows.length,
    rowsIgnored: ignoredRows.length,
    rowsErrored: erroredRows.length
  };

  if (erroredRows.length > 0) {
    // FATAL: rows_errored > 0. No hay transacción que revertir todavía
    // (nunca se abrió), pero igual se registra el intento como FAILED.
    await recordFailedImportStatus(pool, meta, new Error(`${erroredRows.length} fila(s) estructuralmente inválida(s).`));
    await pool.end();
    throw new Error(`Importación abortada: ${erroredRows.length} fila(s) estructuralmente inválida(s) (rows_errored > 0).`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    // Advisory lock transaccional derivado del SHA -evita carrera entre
    // procesos concurrentes importando el mismo archivo a la vez. Se
    // libera solo al COMMIT/ROLLBACK.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [sourceSha256]);

    const alreadyImported = await client.query(
      `SELECT import_id FROM config.contract_import_runs WHERE source_sha256 = $1 AND import_status = 'SUCCESS'`,
      [sourceSha256]
    );
    if (alreadyImported.rows.length > 0) {
      await client.query("COMMIT");
      return { alreadyImported: true, importId: alreadyImported.rows[0].import_id, results: [] };
    }

    // Maestro processed.* obligatorio -FATAL si no está disponible.
    let fieldbeatEquipments;
    let fieldbeatClients;
    let overrides;
    try {
      fieldbeatEquipments = (await client.query("SELECT equipment_key, equipment_uuid, internal_id, client_key FROM processed.fieldbeat_equipments")).rows;
      fieldbeatClients = (await client.query("SELECT client_key, client_name FROM processed.fieldbeat_clients")).rows;
      overrides = (await client.query(
        "SELECT equipment_key, fieldbeat_equipment_id FROM config.contract_equipment_match_overrides WHERE active = true"
      )).rows.map(r => ({ equipmentKey: r.equipment_key, fieldbeatEquipmentId: r.fieldbeat_equipment_id }));
    } catch (masterError) {
      throw new Error(`Maestro processed.* no disponible durante --apply: ${masterError.message}`);
    }

    const importInsert = await client.query(
      `INSERT INTO config.contract_import_runs
         (source_filename, source_sha256, source_sheet, effective_date, rows_read, rows_accepted, rows_ignored, rows_errored, import_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SUCCESS',$9)
       RETURNING import_id`,
      [sourceFilename, sourceSha256, sourceSheet, args.effectiveDate, meta.rowsRead, meta.rowsAccepted, meta.rowsIgnored, meta.rowsErrored, JSON.stringify({ argv: process.argv.slice(2) })]
    );
    const importId = importInsert.rows[0].import_id;

    // Fidelidad completa: TODAS las filas lógicas (equipo + ignoradas), no
    // solo las aceptadas.
    const sourceRowIdByNumber = new Map();
    for (const { row, sourceRowNumber } of [...equipmentRows, ...ignoredRows]) {
      const hash = sourceRowHash(row);
      const insert = await client.query(
        `INSERT INTO config.contract_source_rows (
           import_id, source_row_number, source_row_hash,
           cliente_raw, abreviacion_raw, equipo_raw, serie_raw, anio_instalacion_raw, estado_contrato_raw,
           spa_elekta_raw, lun_vie_raw, sab_dom_raw, soporte_elekta_raw, horarios_atencion_raw,
           hw_refresh_raw, updates_raw, upgrades_raw, situacion_repuestos_raw, q_mant_prev_anio_raw, notas_raw,
           raw_payload
         ) VALUES ($1,$2,$3, $4,$5,$6,$7,$8,$9, $10,$11,$12,$13,$14, $15,$16,$17,$18,$19,$20, $21)
         RETURNING source_row_id`,
        [
          importId, sourceRowNumber, hash,
          row[COLUMN.CLIENTE] || null, row[COLUMN.ABREVIACION] || null, row[COLUMN.EQUIPO] || null, row[COLUMN.SERIE] || null, row[COLUMN.ANIO_INSTALACION] || null, row[COLUMN.ESTADO_CONTRATO] || null,
          row[COLUMN.SPA_ELEKTA] || null, row[COLUMN.LUN_VIE] || null, row[COLUMN.SAB_DOM] || null, row[COLUMN.SOPORTE_ELEKTA] || null, row[COLUMN.HORARIOS_ATENCION] || null,
          row[COLUMN.HW_REFRESH] || null, row[COLUMN.UPDATES] || null, row[COLUMN.UPGRADES] || null, row[COLUMN.SITUACION_REPUESTOS] || null, row[COLUMN.Q_MANT_PREV_ANIO] || null, row[COLUMN.NOTAS] || null,
          JSON.stringify(row)
        ]
      );
      sourceRowIdByNumber.set(sourceRowNumber, insert.rows[0].source_row_id);
    }

    const clientNameNormalizer = createClientNameNormalizer();
    const knownContractStartDates = loadKnownContractStartDates();
    // ETAPA 6.5.2B1 - gobernanza de alias de identidad de cliente
    // (data/config/contracts/client-identity-aliases.json), consumida por
    // matchOneEquipment() en el Nivel 3 (CLIENT_SITE_MODEL). Solo resuelve
    // identidad de cliente -nunca crea un match por sí sola.
    const clientAliasIndex = buildClientIdentityAliasIndex(loadClientIdentityAliases());

    // Registros computados de UNA VEZ, en orden, ANTES del loop de escritura
    // -necesario para poder derivar la lista COMPLETA de candidatos de
    // matching de esta corrida (ver más abajo) sin invocar
    // buildEquipmentRecord() dos veces por fila (evitaría duplicar el
    // estado interno de clientNameNormalizer).
    const records = equipmentRows.map(classifiedRow => buildEquipmentRecord(classifiedRow, args.effectiveDate, clientNameNormalizer));

    // Corrección de dominio (post-6.5.2B1) - un serial exacto tiene
    // precedencia sobre cualquier match de categoría, y cliente+categoría
    // nunca basta sola cuando el cliente tiene más de un equipo de esa
    // categoría (ver fieldbeat-matcher.js). Debe computarse UNA VEZ sobre
    // TODOS los candidatos de ESTA corrida -antes, matchOneEquipment() se
    // llamaba fila por fila sin visibilidad de los demás candidatos, lo que
    // permitía que un candidato sin serial "heredara" por cliente+categoría
    // un equipo que otro candidato de la MISMA corrida ya había reclamado
    // por serial exacto (caso real: Precise SN:105614 heredaba el equipo
    // FieldBeat de Compact SN:201110, mismo cliente Sanatorio Alemán).
    const matchingCandidates = records.map(record => ({
      equipmentKey: record.equipmentKey,
      clientNameCanonical: record.normalizedFields.clientNameCanonical,
      equipmentModel: record.normalizedFields.equipmentModel,
      serialNumber: record.normalizedFields.serialNumber
    }));
    const claimedFieldbeatEquipmentKeys = computeClaimedFieldbeatEquipmentKeys(matchingCandidates, { fieldbeatEquipments, overrides });
    const clientCategorySiblingCounts = computeClientCategorySiblingCounts(matchingCandidates, { clientAliasIndex });

    const results = [];

    for (const record of records) {
      // ETAPA 6.5.1.1: valid_from se resuelve ANTES de buscar la versión
      // "actual" -la búsqueda debe escoparse por (equipment_key, valid_from),
      // nunca solo equipment_key. Dos vigencias de negocio distintas del
      // mismo equipo (valid_from diferente) son autoritativas cada una en lo
      // suyo (invariante 5.7); confundirlas bajo un único "current" global
      // es exactamente el defecto que esta etapa corrige. Usa `record` -ya
      // precomputado en el bloque de ETAPA 6.5.2B1 de arriba, junto con
      // matchingCandidates/claimedFieldbeatEquipmentKeys/
      // clientCategorySiblingCounts- en vez de reconstruirlo vía
      // buildEquipmentRecord(): reconstruirlo acá duplicaría el estado
      // interno de clientNameNormalizer (ver comentario del precompute) Y
      // desalinearía este record del que matchingCandidates ya usó para
      // calcular claimed keys/sibling counts.
      const f = record.normalizedFields;
      const resolvedStart = resolveContractStartDate(
        { equipmentKey: record.equipmentKey, installationMonth: f.installationMonth, installationDatePrecision: f.installationDatePrecision },
        knownContractStartDates
      );

      // IS NOT DISTINCT FROM: comparación NULL-segura -dos versiones
      // UNRESOLVED (valid_from NULL) del mismo equipo SÍ deben tratarse como
      // el mismo período para esta búsqueda (a diferencia del UNIQUE de
      // sql/085, que es una defensa de integridad distinta, no la lógica de
      // decisión de versionado).
      const currentVersionResult = await client.query(
        `SELECT contract_version_id, contract_fingerprint, valid_from
         FROM config.contract_equipment_versions
         WHERE equipment_key = $1 AND valid_from IS NOT DISTINCT FROM $2 AND is_current = true`,
        [record.equipmentKey, resolvedStart.validFrom]
      );
      const currentVersionRow = currentVersionResult.rows[0] ?? null;

      const versionDecision = computeVersionAction(record.contractFingerprint, currentVersionRow, args.effectiveDate);

      if (versionDecision.action === "FATAL_BACKDATED") {
        throw new Error(`FATAL (${record.equipmentKey}): ${versionDecision.reason}`);
      }

      let contractVersionId;

      if (versionDecision.action === "UNCHANGED") {
        contractVersionId = currentVersionRow.contract_version_id;
      } else {
        if (versionDecision.action === "SUPERSEDE") {
          // ETAPA 6.5.1.1: nunca se toca valid_to acá -no hay evidencia de
          // que terminó la vigencia CONTRACTUAL de negocio, solo se
          // corrigió el registro para el mismo período (ver §4/§11 del
          // reporte). superseded_at marca cuándo esta revisión dejó de ser
          // autoritativa, dimensión separada de la vigencia de negocio.
          await client.query(
            `UPDATE config.contract_equipment_versions SET is_current = false, superseded_at = now(), updated_at = now() WHERE contract_version_id = $1`,
            [currentVersionRow.contract_version_id]
          );
        }

        const versionInsert = await client.query(
          VERSION_INSERT_SQL,
          buildVersionInsertParams(record, resolvedStart, { importId })
        );
        contractVersionId = versionInsert.rows[0].contract_version_id;

        // schedule + windows SOLO para versión nueva.
        const scheduleInsert = await client.query(
          `INSERT INTO config.contract_service_schedules (contract_version_id, coverage_type, coverage_condition, parse_status, source_schedule_raw)
           VALUES ($1,$2,$3,$4,$5) RETURNING schedule_id`,
          [contractVersionId, record.coverageType, record.coverageCondition, record.parseStatus, record.attentionScheduleRaw]
        );
        const scheduleId = scheduleInsert.rows[0].schedule_id;

        for (const w of record.serviceWindowRows) {
          await client.query(
            `INSERT INTO config.contract_service_windows (schedule_id, day_of_week, start_time, end_time, all_day, includes_holidays)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [scheduleId, w.dayOfWeek, w.startTime, w.endTime, w.allDay, w.includesHolidays]
          );
        }
      }

      const sourceRowId = sourceRowIdByNumber.get(record.sourceRowNumber);

      const observationInsert = await client.query(
        `INSERT INTO config.contract_equipment_observations
           (import_id, source_row_id, equipment_key, contract_version_id, source_row_hash, contract_fingerprint, effective_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING observation_id`,
        [importId, sourceRowId, record.equipmentKey, contractVersionId, record.sourceRowHash, record.contractFingerprint, args.effectiveDate]
      );
      const observationId = observationInsert.rows[0].observation_id;

      // Matching -re-evaluado en CADA importación, incluso si la versión
      // no cambió (el maestro FieldBeat pudo cambiar entre importaciones).
      const matchResult = matchOneEquipment(
        {
          equipmentKey: record.equipmentKey,
          clientNameCanonical: record.normalizedFields.clientNameCanonical,
          equipmentModel: record.normalizedFields.equipmentModel,
          serialNumber: record.normalizedFields.serialNumber
        },
        { fieldbeatEquipments, fieldbeatClients, overrides, clientAliasIndex, claimedFieldbeatEquipmentKeys, clientCategorySiblingCounts }
      );

      await client.query(
        `INSERT INTO config.contract_equipment_matches
           (observation_id, match_status, match_method, fieldbeat_equipment_key, fieldbeat_equipment_uuid, fieldbeat_internal_id, candidate_count, match_details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          observationId,
          matchResult.matchStatus,
          matchResult.matchMethod,
          matchResult.fieldbeatEquipmentKey,
          matchResult.fieldbeatEquipmentUuid,
          matchResult.fieldbeatInternalId,
          matchResult.candidateCount,
          JSON.stringify(matchResult.matchDetails)
        ]
      );

      const allIssues = [...record.issues, ...matchResultToIssues(matchResult)];
      for (const issue of allIssues) {
        await client.query(
          `INSERT INTO manual_review.contract_data_issues (source_import_id, entity_type, entity_id, issue_type, severity, details)
           VALUES ($1,'CONTRACT_EQUIPMENT_VERSION',$2,$3,'WARNING',$4)`,
          [importId, record.equipmentKey, issue.issueType, JSON.stringify(issue.details)]
        );
      }

      results.push({
        equipmentKey: record.equipmentKey,
        versionAction: versionDecision.action,
        contractVersionId,
        matchStatus: matchResult.matchStatus
      });
    }

    await client.query("COMMIT");
    return { alreadyImported: false, importId, results };
  } catch (error) {
    await client.query("ROLLBACK");
    // Pasa el mismo client (no `pool`): con max:1, `pool.query()` acá
    // haría deadlock esperando una conexión libre que el propio `client`
    // retenido nunca suelta hasta `finally`.
    await recordFailedImportStatus(client, meta, error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
