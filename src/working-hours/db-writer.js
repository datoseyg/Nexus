// Escritura transaccional del builder: consulta fuentes gobernadas, corre
// task-coverage-builder.js por tarea, valida invariantes pre-publicación
// (§14) y publica mediante UPSERT transaccional. Los segmentos conservan
// historial por builder_run_id; nunca se truncan datos persistentes.

import { STATEMENT_TIMEOUT_MS } from "./db-client.js";
import { buildTaskCoverage } from "./task-coverage-builder.js";
import { utcMsToSantiagoParts } from "./timezone-resolver.js";

const BUILD_LOCK_KEY = "working-hours:build";

/**
 * Deriva start_time_local/end_time_local (hora de Santiago, DST-correcta)
 * desde el instante UTC ya resuelto por interval-resolver.js -causa raíz
 * investigada: ni interval-resolver.js ni task-coverage-builder.js
 * calculaban nunca un equivalente local, y publishResults() tampoco lo
 * escribía (v2Columns omitía las columnas). null -> null, nunca fabrica
 * una hora para un intervalo no resuelto (NONE terminal).
 * @param {Date|null} utcDate
 * @returns {string|null} "YYYY-MM-DD HH:mm:ss" o null
 */
export function formatSantiagoLocalTimestamp(utcDate) {
  if (!utcDate) return null;
  const p = utcMsToSantiagoParts(utcDate.getTime());
  const pad = n => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * ETAPA 6.5.2B0 - Construye el índice equipment_uuid -> equipment_key de
 * processed.fieldbeat_equipments, EXCLUYENDO explícitamente filas con
 * equipment_uuid NULL o '' antes de que entren al Map. Causa raíz
 * investigada: `new Map(rows.map(r => [r.equipment_uuid, r.equipment_key]))`
 * usa igualdad SameValueZero -N filas con equipment_uuid=NULL (25 reales en
 * producción, nunca '' -confirmado) colapsan en UNA sola entrada bajo la
 * clave `null`, la última iterada gana, y esa entrada NO es falsy (es un
 * equipment_key real, ajeno) -el guard `if (!key) continue` del llamador
 * nunca la detecta. Consecuencia confirmada contra datos reales: tareas
 * cuyo enlace también tiene equipment_uuid=NULL heredaban arbitrariamente
 * la identidad de OTRO equipo (ej. tareas reales de un cliente heredando
 * el equipo de otro). Con esta función, equipment_uuid NULL/'' nunca entra
 * al índice -su lookup siempre da undefined, cae correctamente en
 * NO_EQUIPMENT (misma semántica que "sin ninguna fila en absoluto": una
 * identidad desconocida nunca es lo mismo que una identidad ausente
 * resuelta, así que degradar a NO_EQUIPMENT es honesto, no fabricado).
 * @param {Array<{ equipment_uuid: string|null, equipment_key: string }>} equipmentRows
 * @returns {Map<string, string>}
 */
export function buildFieldbeatKeyByUuid(equipmentRows) {
  const map = new Map();
  for (const r of equipmentRows) {
    if (r.equipment_uuid === null || r.equipment_uuid === undefined || r.equipment_uuid === "") continue;
    map.set(r.equipment_uuid, r.equipment_key);
  }
  return map;
}

/**
 * Consulta todas las fuentes gobernadas necesarias para correr el builder
 * sobre TODAS las tareas de processed.fieldbeat_tasks. Nunca lee
 * config.holiday_calendar_entries directo -siempre vía las vistas
 * canónicas current_holiday_calendar_*.
 * @param {import("pg").PoolClient|import("pg").Pool} client
 */
export async function loadReferenceData(client) {
  const [tasksRes, bridgeRes, reportFieldsRes, matchesRes, versionsRes, schedulesRes, windowsRes, holidayEntriesRes, clientsRes] = await Promise.all([
    client.query(`SELECT fieldbeat_task_id, start_time, duration_minutes, client_key, task_type, assigned_to FROM processed.fieldbeat_tasks`),
    client.query(`SELECT fieldbeat_task_id, equipment_uuid, equipment_internal_id FROM processed.fieldbeat_task_equipments`),
    client.query(`
      SELECT fieldbeat_task_id, field_name, field_value FROM processed.fieldbeat_report_fields
      WHERE (
        (group_name = 'DESCRIPCIÓN DE LA INTERVENCIÓN' AND field_name IN ('HORA DE INICIO DEL TRABAJO', 'HORA DE TERMINO DEL TRABAJO'))
        OR (group_name = 'ENTREGA' AND field_name = 'FECHA Y HORA DE ENTREGA')
      )
        AND field_value IS NOT NULL AND field_value != ''
    `),
    client.query(`
      SELECT o.equipment_key AS contract_equipment_key, m.fieldbeat_equipment_key, m.match_status, m.match_method, o.effective_date, m.matched_at
      FROM config.contract_equipment_matches m
      JOIN config.contract_equipment_observations o ON o.observation_id = m.observation_id
    `),
    // ETAPA 6.5.1.1: SOLO revisiones autoritativas (is_current=true) -tras
    // la corrección del modelo de versionado, dos revisiones NO autoritativas
    // del mismo período (ej. una corrección de registro Gold->Silver) pueden
    // compartir valid_from con valid_to=NULL simultáneamente; sin este
    // filtro, resolveEquipmentContract() (contract-resolver.js) vería ambas
    // como candidatas abiertas para el mismo rango de fechas -resolución NO
    // determinista (viola invariante 5.6). ORDER BY valid_from DESC: si un
    // equipo llega a tener más de una revisión autoritativa vigente por
    // vigencias de negocio DISTINTAS (valid_from diferente, ver invariante
    // 5.7), el resolver (que usa Array.find) debe encontrar primero la de
    // inicio más reciente que aún aplique a la fecha de la tarea -mismo
    // criterio que "la vigencia más específica gana".
    client.query(`
      SELECT v.contract_version_id, v.equipment_key, v.contract_status_code,
             v.requires_review, v.valid_from, v.valid_to,
             r.effective_date AS source_effective_date
      FROM config.contract_equipment_versions v
      JOIN config.contract_import_runs r ON r.import_id = v.source_import_id
      WHERE v.is_current = true
      ORDER BY COALESCE(v.valid_from, r.effective_date) DESC, v.contract_version_id DESC
    `),
    client.query(`SELECT schedule_id, contract_version_id, coverage_type, parse_status FROM config.contract_service_schedules`),
    client.query(`SELECT schedule_id, day_of_week, start_time, end_time, all_day FROM config.contract_service_windows`),
    client.query(`SELECT local_date, jurisdiction FROM config.current_holiday_calendar_entries WHERE jurisdiction = 'CL'`),
    // Fuente gobernada real de client_name/client_rut -processed.fieldbeat_tasks
    // solo tiene client_key (identidad estable), nunca el nombre/RUT legible.
    client.query(`SELECT client_key, client_name, rut FROM processed.fieldbeat_clients`)
  ]);

  const clientByKey = new Map(clientsRes.rows.map(r => [r.client_key, { clientName: r.client_name, clientRut: r.rut }]));

  // processed.fieldbeat_equipments (equipment_uuid -> equipment_key FieldBeat) -necesario para unir el bridge con los matches.
  const fbEquipRes = await client.query(`SELECT equipment_uuid, equipment_key FROM processed.fieldbeat_equipments`);
  const fbKeyByUuid = buildFieldbeatKeyByUuid(fbEquipRes.rows);

  // processed.fieldbeat_task_equipments puede traer filas duplicadas
  // (tarea, equipo) por reextracciones del ETL de origen -se dedupea por
  // fieldbeatEquipmentKey acá, antes de que le llegue a task-coverage-
  // builder.js, que asume como invariante "un equipo aparece a lo sumo una
  // vez por tarea" (fbwhel UNIQUE (working_hours_id, fieldbeat_equipment_key)).
  const equipByTask = new Map();
  for (const r of bridgeRes.rows) {
    const key = fbKeyByUuid.get(r.equipment_uuid);
    if (!key) continue;
    const taskId = String(r.fieldbeat_task_id);
    const list = equipByTask.get(taskId) ?? [];
    if (!list.some(e => e.fieldbeatEquipmentKey === key)) {
      list.push({ fieldbeatEquipmentKey: key, fieldbeatInternalId: r.equipment_internal_id });
    }
    equipByTask.set(taskId, list);
  }

  const starts = new Map(), ends = new Map(), deliveries = new Map();
  for (const row of reportFieldsRes.rows) {
    const taskId = String(row.fieldbeat_task_id);
    if (row.field_name === "HORA DE INICIO DEL TRABAJO") starts.set(taskId, row.field_value);
    else if (row.field_name === "HORA DE TERMINO DEL TRABAJO") ends.set(taskId, row.field_value);
    else deliveries.set(taskId, row.field_value);
  }

  // "Más reciente gana" por equipment_key (mismo patrón que config.contract_equipment_analysis).
  const matchByFbKey = new Map();
  for (const r of matchesRes.rows) {
    const existing = matchByFbKey.get(r.fieldbeat_equipment_key);
    if (!existing || r.effective_date > existing.effectiveDate || (r.effective_date === existing.effectiveDate && r.matched_at > existing.matchedAt)) {
      matchByFbKey.set(r.fieldbeat_equipment_key, { matchStatus: r.match_status, matchMethod: r.match_method, contractEquipmentKey: r.contract_equipment_key, effectiveDate: r.effective_date, matchedAt: r.matched_at });
    }
  }

  const versionsByEquipmentKey = new Map();
  for (const r of versionsRes.rows) {
    const list = versionsByEquipmentKey.get(r.equipment_key) ?? [];
    list.push({
      contractVersionId: r.contract_version_id,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      sourceEffectiveDate: r.source_effective_date,
      contractStatusCode: r.contract_status_code,
      requiresReview: r.requires_review
    });
    versionsByEquipmentKey.set(r.equipment_key, list);
  }

  const scheduleByVersionId = new Map(schedulesRes.rows.map(r => [r.contract_version_id, { scheduleId: r.schedule_id, coverageType: r.coverage_type, parseStatus: r.parse_status }]));

  const windowsByScheduleId = new Map();
  for (const r of windowsRes.rows) {
    const list = windowsByScheduleId.get(r.schedule_id) ?? [];
    list.push({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, allDay: r.all_day });
    windowsByScheduleId.set(r.schedule_id, list);
  }

  const holidayDates = new Set(holidayEntriesRes.rows.map(r => String(r.local_date)));
  // Rango de cobertura VALIDATED real -consultado aparte para responder
  // COVERAGE_UNKNOWN fuera de rango en vez de asumir "no feriado" (mismo
  // criterio que sql/080).
  const coverageRes = await client.query(`SELECT coverage_range FROM config.current_holiday_calendar_coverage WHERE jurisdiction = 'CL'`);
  const coverageRanges = coverageRes.rows.map(r => r.coverage_range);
  function holidayLookup(localDate) {
    const covered = coverageRanges.some(range => isDateInPgRange(localDate, range));
    if (!covered) return "COVERAGE_UNKNOWN";
    return holidayDates.has(localDate) ? "CONFIRMED_HOLIDAY" : "CONFIRMED_NOT_HOLIDAY";
  }

  return { tasks: tasksRes.rows, equipByTask, starts, ends, deliveries, matchByFbKey, versionsByEquipmentKey, scheduleByVersionId, windowsByScheduleId, holidayLookup, clientByKey };
}

/**
 * Texto descriptivo plano de los equipos de una tarea (paridad con el mart
 * legado, ver sql/081 -"no identity-bearing"): ids internos distintos,
 * ordenados para salida determinista, unidos por ", ". Una tarea sin
 * equipos retorna null (NUNCA "" ni un string vacío) -ausencia real de
 * equipo, no un dato vacío.
 * @param {Array<{ fieldbeatInternalId: string|null }>} equipmentList
 * @returns {string|null}
 */
export function buildEquipmentInternalIds(equipmentList) {
  if (!equipmentList || equipmentList.length === 0) return null;
  const ids = [...new Set(equipmentList.map(e => e.fieldbeatInternalId).filter(id => id !== null && id !== undefined && id !== ""))];
  if (ids.length === 0) return null;
  return ids.sort().join(", ");
}

function isDateInPgRange(localDate, pgRange) {
  // pgRange llega como string "[2018-01-01,2027-01-01)" -parseo simple, sin
  // dependencia nueva (formato estable de Postgres para daterange en texto).
  const match = String(pgRange).match(/^[[(]([^,]*),([^,)\]]*)[)\]]$/);
  if (!match) return false;
  const [, lo, hi] = match;
  return (!lo || localDate >= lo) && (!hi || localDate < hi);
}

/**
 * Corre el builder completo (dry-run: no escribe nada, solo calcula).
 * @param {import("pg").Pool} pool
 * @returns {Promise<{ results: object[], summary: object }>}
 */
export async function runBuild(pool) {
  const refData = await loadReferenceData(pool);
  const businessHoursCfg = JSON.parse(await (await import("node:fs/promises")).readFile("data/config/business-hours.json", "utf8"));

  const results = [];
  for (const task of refData.tasks) {
    const taskId = String(task.fieldbeat_task_id);
    const equipmentList = refData.equipByTask.get(taskId) ?? [];
    const equipmentInputs = equipmentList.map(eq => ({
      fieldbeatEquipmentKey: eq.fieldbeatEquipmentKey,
      match: refData.matchByFbKey.get(eq.fieldbeatEquipmentKey) ?? null,
      versions: refData.versionsByEquipmentKey.get(refData.matchByFbKey.get(eq.fieldbeatEquipmentKey)?.contractEquipmentKey) ?? [],
      scheduleByVersionId: refData.scheduleByVersionId,
      windowsByScheduleId: refData.windowsByScheduleId
    }));

    const result = buildTaskCoverage({
      task: {
        startTimeRaw: task.start_time, reportedStartRaw: refData.starts.get(taskId) ?? null, reportedEndRaw: refData.ends.get(taskId) ?? null,
        deliveredRaw: refData.deliveries.get(taskId) ?? null,
        durationMinutes: task.duration_minutes === null ? null : Number(task.duration_minutes),
        clientKey: task.client_key, taskType: task.task_type, assignedTo: task.assigned_to
      },
      confidenceContext: { businessHoursStatus: businessHoursCfg.status, holidaysStatus: "VALIDATED" }, // calendario gobernado real 2018-2026 -ver 6.6B1.1
      equipmentInputs,
      holidayLookup: refData.holidayLookup,
      businessHoursCfg
    });

    const clientInfo = refData.clientByKey.get(task.client_key) ?? null;
    results.push({
      fieldbeatTaskId: task.fieldbeat_task_id,
      clientKey: task.client_key,
      clientName: clientInfo?.clientName ?? null,
      clientRut: clientInfo?.clientRut ?? null,
      taskType: task.task_type,
      assignedTo: task.assigned_to,
      equipmentInternalIds: buildEquipmentInternalIds(equipmentList),
      ...result
    });
  }

  const summary = summarizeResults(results);
  return { results, summary };
}

export function summarizeResults(results) {
  const byDataBasis = {};
  const byCoverageReasonCode = {};
  const byCalculationStatus = {};
  const byConfidenceLabel = {};
  const byContractResolutionLabel = {};
  let tasksWithoutEquipment = 0, multiEquipmentSameCoverage = 0, multiEquipmentConflict = 0;

  for (const r of results) {
    byDataBasis[r.dataBasis] = (byDataBasis[r.dataBasis] ?? 0) + 1;
    byCoverageReasonCode[r.coverageReasonCode] = (byCoverageReasonCode[r.coverageReasonCode] ?? 0) + 1;
    byCalculationStatus[r.calculationStatus] = (byCalculationStatus[r.calculationStatus] ?? 0) + 1;
    if (r.confidenceLabel) byConfidenceLabel[r.confidenceLabel] = (byConfidenceLabel[r.confidenceLabel] ?? 0) + 1;
    if (r.contractResolutionLabel) byContractResolutionLabel[r.contractResolutionLabel] = (byContractResolutionLabel[r.contractResolutionLabel] ?? 0) + 1;
    if (r.contractualReasonCode === "NO_EQUIPMENT") tasksWithoutEquipment++;
    if (r.coverageReasonCode === "MULTIPLE_EQUIPMENT_SAME_COVERAGE") multiEquipmentSameCoverage++;
    if (r.contractualReasonCode === "MULTIPLE_EQUIPMENT_CONFLICT") multiEquipmentConflict++;
  }

  return { totalTasks: results.length, byDataBasis, byCoverageReasonCode, byCalculationStatus, byConfidenceLabel, byContractResolutionLabel, tasksWithoutEquipment, multiEquipmentSameCoverage, multiEquipmentConflict };
}

/**
 * Valida invariantes pre-publicación (§14) sobre los resultados calculados
 * en memoria, ANTES de intentar publicar nada.
 * @param {object[]} results
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBeforePublish(results) {
  const errors = [];
  const seenTaskIds = new Set();

  for (const r of results) {
    if (seenTaskIds.has(r.fieldbeatTaskId)) errors.push(`fieldbeat_task_id ${r.fieldbeatTaskId} duplicado en los resultados.`);
    seenTaskIds.add(r.fieldbeatTaskId);

    if (r.dataBasis === "NONE" && (r.coveredSeconds !== null || r.afterHoursTotalSeconds !== null)) {
      errors.push(`tarea ${r.fieldbeatTaskId}: data_basis=NONE pero tiene minutos no-NULL.`);
    }
    if (r.dataBasis !== "NONE" && r.coveredSeconds !== null && r.outsideCoverageSeconds !== null) {
      if (r.coveredSeconds + r.outsideCoverageSeconds !== r.durationSeconds) {
        errors.push(`tarea ${r.fieldbeatTaskId}: covered+outside (${r.coveredSeconds + r.outsideCoverageSeconds}) != duration_seconds (${r.durationSeconds}).`);
      }
    }
    if (r.dataBasis === "CONTRACTUAL" && r.contractResolutionConfidence === null) {
      errors.push(`tarea ${r.fieldbeatTaskId}: data_basis=CONTRACTUAL sin contract_resolution_confidence.`);
    }

    const primaryCount = r.equipmentLinks.filter(l => l.isPrimary).length;
    if (r.coverageReasonCode === "MULTIPLE_EQUIPMENT_SAME_COVERAGE" || r.coverageReasonCode === "WITHIN_MATCHED_CONTRACT") {
      if (r.dataBasis === "CONTRACTUAL" && primaryCount !== 1) errors.push(`tarea ${r.fieldbeatTaskId}: se esperaba exactamente 1 equipo primario, hay ${primaryCount}.`);
    }
    if (r.contractualReasonCode === "MULTIPLE_EQUIPMENT_CONFLICT" || r.contractualReasonCode === "NO_EQUIPMENT") {
      if (primaryCount !== 0) errors.push(`tarea ${r.fieldbeatTaskId}: conflicto/sin equipo pero hay ${primaryCount} primario(s).`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * NEXUS V3 - guard de cobertura de feriados para el refresh orquestado
 * (scripts/pipeline/run-data-refresh.mjs, etapa VALIDATE_AFTER_HOURS).
 * Nunca reimporta feriados (eso sigue siendo exclusivamente manual, ver
 * `npm run holidays:import` - fechas efectivas reales, nunca inventadas) -
 * solo verifica que YA exista, para cada año presente en
 * processed.fieldbeat_tasks, una fila VALIDATED en
 * config.current_holiday_calendar_coverage que cubra el año calendario
 * COMPLETO (jurisdiction='CL'). Devuelve los años SIN cobertura completa -
 * lista vacía = todo cubierto. El caller decide qué hacer con el resultado
 * (el orquestador lo trata como falla dura: nunca SUCCEEDED en silencio).
 * @param {import("pg").Pool | import("pg").PoolClient} pool
 * @returns {Promise<number[]>} años (ascendente) sin cobertura VALIDATED completa
 */
export async function findTaskYearsMissingHolidayCoverage(pool) {
  const result = await pool.query(`
    WITH task_years AS (
      SELECT DISTINCT EXTRACT(YEAR FROM start_time)::int AS yr
      FROM processed.fieldbeat_tasks
      WHERE start_time IS NOT NULL
    )
    SELECT ty.yr
    FROM task_years ty
    WHERE NOT EXISTS (
      SELECT 1 FROM config.current_holiday_calendar_coverage c
      WHERE c.jurisdiction = 'CL'
        AND c.coverage_range @> daterange(make_date(ty.yr, 1, 1), make_date(ty.yr + 1, 1, 1))
    )
    ORDER BY ty.yr
  `);
  return result.rows.map(row => Number(row.yr));
}

/**
 * Publica los resultados vía UPSERT transaccional, con advisory lock,
 * validación pre-publicación y rollback completo ante cualquier fallo.
 * @param {import("pg").Pool} pool
 * @param {object[]} results
 * @param {string} builderRunId uuid ya insertado en audit.pipeline_runs
 */
// Tamaño de lote para INSERTs multi-fila: medido empíricamente (§13 del
// reporte de 6.6B2) que un INSERT por fila individual es el verdadero cuello
// de botella de la ventana de lock (INSERT fila-a-fila tomó ~197s
// a 50.000 filas por ~200.000 round-trips de red, no por el volumen de datos
// en sí) -agrupar en lotes de VALUES multi-fila reduce eso a segundos sin
// cambiar de estrategia de publicación. 500 filas/lote mantiene el conteo de
// parámetros muy por debajo del límite de Postgres (65535) incluso para la
// tabla de segmentos (24 columnas x 500 = 12.000).
const INSERT_BATCH_SIZE = 500;

export function buildBulkInsert(table, columns, rows, {
  returning,
  conflictTarget,
  updateColumns
} = {}) {
  const values = [];
  const placeholders = [];
  let p = 1;
  for (const row of rows) {
    const rowPlaceholders = row.map(() => `$${p++}`);
    placeholders.push(`(${rowPlaceholders.join(",")})`);
    values.push(...row);
  }
  const conflict = conflictTarget?.length
    ? ` ON CONFLICT (${conflictTarget.join(",")}) DO UPDATE SET ${updateColumns.map(column => `${column} = EXCLUDED.${column}`).join(",")}`
    : "";
  const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders.join(",")}${conflict}${returning ? ` RETURNING ${returning}` : ""}`;
  return { sql, values };
}

async function bulkInsertChunked(client, table, columns, allRows, options = {}) {
  const returned = [];
  for (let i = 0; i < allRows.length; i += INSERT_BATCH_SIZE) {
    const chunk = allRows.slice(i, i + INSERT_BATCH_SIZE);
    if (chunk.length === 0) continue;
    const { sql, values } = buildBulkInsert(table, columns, chunk, options);
    const res = await client.query(sql, values);
    if (options.returning) returned.push(...res.rows);
  }
  return returned;
}

export async function publishResults(pool, results, builderRunId) {
  const validation = validateBeforePublish(results);
  if (!validation.ok) throw new Error(`Validación pre-publicación falló:\n${validation.errors.join("\n")}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [BUILD_LOCK_KEY]);

    const v2Columns = [
      "fieldbeat_task_id", "client_key", "client_rut", "client_name", "task_type", "assigned_to", "equipment_internal_ids",
      "calculation_status", "coverage_classification", "coverage_reason_code",
      "contractual_attempt_status", "contractual_coverage_classification", "contractual_reason_code", "fallback_used",
      "data_basis", "contract_resolution_confidence", "contract_resolution_label", "confidence_model_version",
      "start_time_utc", "start_time_local", "end_time_utc", "end_time_local", "duration_seconds",
      "analysis_interval_basis", "analysis_fallback_used", "analysis_fallback_reason",
      "reported_work_start_utc", "reported_work_start_local", "reported_work_start_raw", "reported_work_start_parse_status",
      "reported_work_end_utc", "reported_work_end_local", "reported_work_end_raw", "reported_work_end_parse_status",
      "delivered_at_utc", "delivered_at_local", "delivered_raw", "delivered_parse_status", "temporal_issue_codes",
      "covered_seconds", "outside_coverage_seconds", "after_hours_weekday_seconds", "weekend_seconds", "holiday_seconds",
      "after_hours_total_seconds", "after_hours_rate", "is_after_hours_task",
      "confidence_score", "confidence_label", "confidence_factors", "calculation_method", "builder_run_id"
    ];
    const v2Rows = results.map(r => [
      r.fieldbeatTaskId, r.clientKey, r.clientRut, r.clientName, r.taskType, r.assignedTo, r.equipmentInternalIds,
      r.calculationStatus, r.coverageClassification, r.coverageReasonCode,
      r.contractualAttemptStatus, r.contractualCoverageClassification, r.contractualReasonCode, r.fallbackUsed,
      r.dataBasis, r.contractResolutionConfidence, r.contractResolutionLabel, "contract-v1",
      r.startTimeUtc, formatSantiagoLocalTimestamp(r.startTimeUtc), r.endTimeUtc, formatSantiagoLocalTimestamp(r.endTimeUtc), r.durationSeconds,
      r.analysisIntervalBasis, r.analysisFallbackUsed, r.analysisFallbackReason,
      r.reportedWorkStartAt, formatSantiagoLocalTimestamp(r.reportedWorkStartAt), r.reportedWorkStartRaw, r.reportedWorkStartParseStatus,
      r.reportedWorkEndAt, formatSantiagoLocalTimestamp(r.reportedWorkEndAt), r.reportedWorkEndRaw, r.reportedWorkEndParseStatus,
      r.deliveredAt, formatSantiagoLocalTimestamp(r.deliveredAt), r.deliveredRaw, r.deliveredParseStatus, r.temporalIssues,
      r.coveredSeconds, r.outsideCoverageSeconds, r.afterHoursWeekdaySeconds, r.weekendSeconds, r.holidaySeconds,
      r.afterHoursTotalSeconds, r.afterHoursRate, r.isAfterHoursTask,
      r.confidenceScore, r.confidenceLabel, r.confidenceFactors, r.calculationMethod, builderRunId
    ]);
    // INSERT multi-fila con RETURNING preserva el orden de entrada (garantía
    // documentada de Postgres para VALUES literales) -se mapea 1:1 de vuelta
    // a `results` para poder construir los hijos (bridge/segmentos) sin una
    // segunda consulta.
    const returnedIds = await bulkInsertChunked(client, "marts.fieldbeat_working_hours_analysis_v2", v2Columns, v2Rows, {
      conflictTarget: ["fieldbeat_task_id"],
      updateColumns: v2Columns.filter(column => column !== "fieldbeat_task_id"),
      returning: "working_hours_id"
    });

    const linkColumns = [
      "working_hours_id", "fieldbeat_equipment_key", "contract_equipment_key", "contract_version_id", "schedule_id",
      "contract_valid_from", "contract_valid_to", "match_status", "parse_status",
      "equipment_coverage_classification", "equipment_reason_code", "coverage_fingerprint", "is_primary"
    ];
    const linkRows = [];
    const segColumns = [
      "fieldbeat_task_id", "fieldbeat_equipment_key", "schedule_source", "contract_equipment_key", "contract_version_id", "schedule_id",
      "match_status", "coverage_type", "parse_status", "segment_start_utc", "segment_end_utc", "segment_local_date", "day_of_week",
      "boundary_reasons", "is_holiday", "holiday_coverage_status", "segment_seconds", "segment_calculation_status", "segment_coverage_state",
      "segment_reason_code", "outside_coverage_bucket", "covered_seconds", "outside_coverage_seconds", "builder_run_id"
    ];
    const segRows = [];

    results.forEach((r, i) => {
      const workingHoursId = returnedIds[i].working_hours_id;
      for (const link of r.equipmentLinks) {
        linkRows.push([workingHoursId, link.fieldbeatEquipmentKey, link.contractEquipmentKey, link.contractVersionId, link.scheduleId, link.contractValidFrom, link.contractValidTo, link.matchStatus, link.parseStatus, link.equipmentCoverageClassification, link.equipmentReasonCode, link.coverageFingerprint, link.isPrimary]);
      }
      for (const seg of r.segments) {
        segRows.push([
          r.fieldbeatTaskId, seg.fieldbeatEquipmentKey, seg.scheduleSource, seg.contractEquipmentKey, seg.contractVersionId, seg.scheduleId,
          seg.matchStatus, seg.coverageType, seg.parseStatus, new Date(seg.segmentStartUtcMs), new Date(seg.segmentEndUtcMs), seg.localDate, seg.dayOfWeek,
          [], seg.isHoliday, seg.holidayCoverageStatus, seg.segmentSeconds, seg.segmentCalculationStatus, seg.segmentCoverageState,
          seg.segmentReasonCode, seg.outsideCoverageBucket, seg.coveredSeconds, seg.outsideCoverageSeconds, builderRunId
        ]);
      }
    });

    await bulkInsertChunked(client, "marts.fieldbeat_working_hours_equipment_links", linkColumns, linkRows, {
      conflictTarget: ["working_hours_id", "fieldbeat_equipment_key"],
      updateColumns: linkColumns.filter(column => !["working_hours_id", "fieldbeat_equipment_key"].includes(column))
    });
    await bulkInsertChunked(client, "marts.fieldbeat_contract_coverage_segments", segColumns, segRows);

    // Recrea la vista en la MISMA transacción para mantener su contrato de
    // columnas sincronizado con la migración vigente.
    const viewSql = await (await import("node:fs/promises")).readFile("sql/082_working_hours_analysis_current_view.sql", "utf8");
    await client.query(viewSql);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
