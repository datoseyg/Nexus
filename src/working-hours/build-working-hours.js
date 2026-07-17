// Entrypoint real de `working-hours:build` / `working-hours:parity`
// (ETAPA 6.6B2 §12). Tres subcomandos, seguros por defecto:
//   dry-run  -calcula todo, imprime diagnóstico completo, NUNCA escribe.
//   apply    -requiere --confirm; staging + validación pre-publicación +
//             lock advisory + publicación transaccional + rollback completo
//             ante cualquier fallo (ver db-writer.js).
//   parity   -compara legacy_exact_parity/legacy_corrected_v2 contra el
//             mart legado congelado (marts.fieldbeat_working_hours_analysis,
//             3.747 filas), leído directo del DuckDB local -es la fuente de
//             verdad del mart congelado, no vive en el Postgres del builder.
//
// parity NUNCA requiere WORKING_HOURS_DB_URL (no escribe, no necesita el
// Postgres desechable) -solo lee data/warehouse/eyg_nexus.duckdb en modo
// READ_ONLY y los archivos de configuración gobernados del repo.

import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { parseArgs, validateArgs } from "./cli.js";
import { createPool } from "./db-client.js";
import { runBuild, validateBeforePublish, publishResults, summarizeResults } from "./db-writer.js";
import { segmentLegacyCorrectedV2, computeLegacyExactParity } from "./legacy-global-schedule.js";
import { resolveInterval } from "./interval-resolver.js";
import { offsetMinutesAt, localDateStringAt } from "./timezone-resolver.js";

const CLOSED_DIFF_CATEGORIES = Object.freeze(["DST_BOUNDARY_TASK", "HOLIDAY_CALENDAR_DIFFERENCE", "ROUNDING_CORRECTION", "SOURCE_DATA_CORRECTION", "UNEXPLAINED"]);

function num(v) { return typeof v === "bigint" ? Number(v) : v; }
function microsToIso(v) {
  if (v === null || v === undefined) return null;
  const micros = typeof v === "bigint" ? Number(v) : (v && v.micros !== undefined ? Number(v.micros) : Number(v));
  return new Date(micros / 1000).toISOString();
}

function filterTasksByRange(tasks, fromDate, toDate) {
  if (!fromDate && !toDate) return tasks;
  return tasks.filter(t => {
    if (!t.start_time) return true; // sin start_time -no se puede acotar por fecha, se incluye (la cascada la marcará NONE igual)
    const d = new Date(t.start_time).toISOString().slice(0, 10);
    return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
  });
}

async function runDryRun(args) {
  const pool = createPool();
  try {
    const { results, summary: fullSummary } = await runBuild(pool);
    const scoped = filterTasksByRange(results.map(r => ({ ...r, start_time: r.startTimeUtc })), args.from, args.to);
    const summary = args.from || args.to ? summarizeResults(scoped) : fullSummary;

    console.log("=== working-hours:build dry-run (sin escrituras) ===");
    if (args.from || args.to) console.log(`Rango: from=${args.from ?? "(inicio)"} to=${args.to ?? "(fin)"}`);
    console.log(`Total tareas: ${summary.totalTasks}`);
    console.log("data_basis:", JSON.stringify(summary.byDataBasis, null, 2));
    console.log("coverage_reason_code:", JSON.stringify(summary.byCoverageReasonCode, null, 2));
    console.log("calculation_status:", JSON.stringify(summary.byCalculationStatus, null, 2));
    console.log("confidence_label:", JSON.stringify(summary.byConfidenceLabel, null, 2));
    console.log("contract_resolution_label:", JSON.stringify(summary.byContractResolutionLabel, null, 2));
    console.log(`tasks_without_equipment: ${summary.tasksWithoutEquipment}`);
    console.log(`multi_equipment_same_coverage: ${summary.multiEquipmentSameCoverage}`);
    console.log(`multi_equipment_conflict: ${summary.multiEquipmentConflict}`);

    const validation = validateBeforePublish(results);
    console.log(`Validación pre-publicación: ${validation.ok ? "OK" : `${validation.errors.length} error(es)`}`);
    if (!validation.ok) {
      for (const e of validation.errors.slice(0, 20)) console.error(`  - ${e}`);
      process.exitCode = 1;
    }
    return { results, summary, validation };
  } finally {
    await pool.end();
  }
}

async function runApply(args) {
  const pool = createPool();
  const { results } = await runBuild(pool);
  const scoped = filterTasksByRange(results.map(r => ({ ...r, start_time: r.startTimeUtc })), args.from, args.to);
  const targetResults = args.from || args.to ? scoped : results;

  const validation = validateBeforePublish(targetResults);
  if (!validation.ok) {
    console.error(`Validación pre-publicación falló (${validation.errors.length} error(es)) -apply abortado, nada escrito:`);
    for (const e of validation.errors.slice(0, 20)) console.error(`  - ${e}`);
    process.exitCode = 1;
    await pool.end();
    return { ok: false, validation };
  }

  const runRes = await pool.query(
    `INSERT INTO audit.pipeline_runs (stage, status, metadata) VALUES ($1,'STARTED',$2) RETURNING run_id`,
    ["working-hours-build", JSON.stringify({ from: args.from, to: args.to, taskCount: targetResults.length })]
  );
  const builderRunId = runRes.rows[0].run_id;

  try {
    await publishResults(pool, targetResults, builderRunId);
    await pool.query(
      `UPDATE audit.pipeline_runs SET status='SUCCESS', finished_at=now(), rows_affected=$2 WHERE run_id=$1`,
      [builderRunId, targetResults.length]
    );
    console.log(`Publicado. builder_run_id=${builderRunId}, filas=${targetResults.length}.`);
    return { ok: true, builderRunId, rowCount: targetResults.length };
  } catch (error) {
    await pool.query(
      `UPDATE audit.pipeline_runs SET status='FAILED', finished_at=now(), error_message=$2 WHERE run_id=$1`,
      [builderRunId, String(error?.message ?? error)]
    );
    console.error("Apply falló -ROLLBACK completo ya ejecutado por publishResults, nada quedó escrito:");
    console.error(error);
    process.exitCode = 1;
    return { ok: false, error };
  } finally {
    await pool.end();
  }
}

// ============================================================
// parity -legacy_exact_parity (tolerancia cero) y legacy_corrected_v2
// (diferencias clasificadas, taxonomía cerrada, 0 UNEXPLAINED requerido).
// Lee el DuckDB local (fuente del mart congelado) -nunca Postgres.
// ============================================================

async function loadGovernedHolidays() {
  const dates = new Set();
  const dirs = ["data/config/holidays/CL"];
  for (const dir of dirs) {
    for (const file of await fs.readdir(dir)) {
      const bundle = JSON.parse(await fs.readFile(`${dir}/${file}`, "utf8"));
      for (const e of bundle.events) dates.add(e.local_date);
    }
  }
  return {
    dates,
    lookup(localDate) {
      if (localDate < "2018-01-01" || localDate >= "2027-01-01") return "COVERAGE_UNKNOWN";
      return dates.has(localDate) ? "CONFIRMED_HOLIDAY" : "CONFIRMED_NOT_HOLIDAY";
    }
  };
}

function touchedLocalDates(startUtcMs, endUtcMs) {
  const out = [];
  let cursor = localDateStringAt(startUtcMs);
  const last = localDateStringAt(endUtcMs - 1);
  out.push(cursor);
  while (cursor < last) {
    const [y, m, d] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    out.push(cursor);
  }
  return out;
}

function dstTransitionDates(localDates) {
  const out = [];
  for (const localDate of localDates) {
    const [y, m, d] = localDate.split("-").map(Number);
    const startOfDayUtc = Date.UTC(y, m - 1, d, 4, 0, 0);
    const endOfDayUtc = Date.UTC(y, m - 1, d, 23, 59, 0);
    if (offsetMinutesAt(startOfDayUtc) !== offsetMinutesAt(endOfDayUtc)) out.push(localDate);
  }
  return out;
}

async function loadDuckDbFixtures() {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create("data/warehouse/eyg_nexus.duckdb", { access_mode: "READ_ONLY" });
  const conn = await instance.connect();

  const tasksRes = await conn.runAndReadAll(`SELECT fieldbeat_task_id, start_time, duration_minutes, client_key, task_type, assigned_to FROM processed.fieldbeat_tasks`);
  const tasks = tasksRes.getRowObjects();

  const rfRes = await conn.runAndReadAll(`
    SELECT fieldbeat_task_id, field_name, field_value FROM processed.fieldbeat_report_fields
    WHERE group_name = 'DESCRIPCIÓN DE LA INTERVENCIÓN' AND field_name IN ('HORA DE INICIO DEL TRABAJO', 'HORA DE TERMINO DEL TRABAJO')
      AND field_value IS NOT NULL AND field_value != ''
  `);
  const starts = new Map(), ends = new Map();
  for (const row of rfRes.getRowObjects()) {
    const taskId = String(num(row.fieldbeat_task_id));
    if (row.field_name === "HORA DE INICIO DEL TRABAJO") starts.set(taskId, row.field_value);
    else ends.set(taskId, row.field_value);
  }

  const frozenRes = await conn.runAndReadAll(`SELECT * FROM marts.fieldbeat_working_hours_analysis`);
  const frozenByTaskId = new Map(frozenRes.getRowObjects().map(r => [String(num(r.fieldbeat_task_id)), r]));

  return { tasks, starts, ends, frozenByTaskId };
}

async function runParityExact({ tasks, starts, ends, frozenByTaskId }, businessHoursCfg, legacyHolidaysCfg) {
  let compared = 0, identical = 0, different = 0;
  const differences = [];

  for (const task of tasks) {
    const taskId = String(num(task.fieldbeat_task_id));
    const frozen = frozenByTaskId.get(taskId);
    if (!frozen) continue;
    compared++;

    const result = computeLegacyExactParity({
      task: { start_time: microsToIso(task.start_time), duration_minutes: num(task.duration_minutes), client_key: task.client_key, task_type: task.task_type, assigned_to: task.assigned_to },
      reportedInterval: starts.has(taskId) || ends.has(taskId) ? { startRaw: starts.get(taskId) ?? "", endRaw: ends.get(taskId) ?? "" } : null,
      businessHoursCfg, holidaysCfg: legacyHolidaysCfg
    });

    const fields = ["business_minutes", "after_hours_weekday_minutes", "weekend_minutes", "holiday_minutes", "after_hours_total_minutes", "after_hours_rate", "is_after_hours_task", "calculation_method", "calculation_status", "confidence_score", "confidence_label"];
    const diffs = fields.filter(f => String(result[f]) !== String(num(frozen[f])));
    if (diffs.length === 0) { identical++; continue; }
    different++;
    if (differences.length < 20) differences.push({ taskId, diffs, mine: diffs.reduce((o, f) => ({ ...o, [f]: result[f] }), {}), frozen: diffs.reduce((o, f) => ({ ...o, [f]: num(frozen[f]) }), {}) });
  }

  return { compared, identical, different, differences, tolerance: "cero (bit-a-bit por campo)" };
}

async function runParityCorrected({ tasks, starts, ends, frozenByTaskId }, businessHoursCfg, legacyHolidaySet, governedHolidayLookup) {
  let compared = 0, identical = 0, different = 0;
  const categoryCounts = { DST_BOUNDARY_TASK: 0, HOLIDAY_CALENDAR_DIFFERENCE: 0, ROUNDING_CORRECTION: 0, SOURCE_DATA_CORRECTION: 0, UNEXPLAINED: 0 };
  const allDiffs = [];

  for (const task of tasks) {
    const taskId = String(num(task.fieldbeat_task_id));
    const frozen = frozenByTaskId.get(taskId);
    if (!frozen) continue;
    compared++;

    const durationMinutesRaw = num(task.duration_minutes);
    const resolved = resolveInterval({
      startTimeRaw: microsToIso(task.start_time),
      reportedStartRaw: starts.get(taskId) ?? null,
      reportedEndRaw: ends.get(taskId) ?? null,
      durationMinutes: durationMinutesRaw
    });

    let myBusinessSeconds = null, myTotalAfterHoursSeconds = null, myCalcStatus, myUnknownGap = false;
    if (resolved.startTimeUtc && resolved.endTimeUtc) {
      const segments = segmentLegacyCorrectedV2(resolved.startTimeUtc.getTime(), resolved.endTimeUtc.getTime(), businessHoursCfg, governedHolidayLookup);
      let covered = 0, outside = 0;
      for (const s of segments) {
        if (s.segmentCoverageState === "NOT_CALCULABLE") { myUnknownGap = true; continue; }
        covered += s.coveredSeconds;
        outside += s.outsideCoverageSeconds;
      }
      myBusinessSeconds = covered;
      myTotalAfterHoursSeconds = outside;
      myCalcStatus = myUnknownGap ? "NOT_CALCULABLE" : (resolved.method === "PARTIAL_ESTIMATE" ? "CALCULATED_WITH_WARNINGS" : "CALCULATED");
    } else {
      myCalcStatus = "NOT_CALCULABLE";
    }

    const frozenBusinessMin = num(frozen.business_minutes);
    const frozenAfterHoursMin = num(frozen.after_hours_total_minutes);
    const frozenStatus = frozen.calculation_status;
    const frozenMethod = frozen.calculation_method;

    const myBusinessMin = myBusinessSeconds !== null ? myBusinessSeconds / 60 : null;
    const myAfterHoursMin = myTotalAfterHoursSeconds !== null ? myTotalAfterHoursSeconds / 60 : null;

    const businessDiffers = myBusinessMin === null ? frozenStatus !== "NOT_CALCULABLE" : Math.abs(myBusinessMin - frozenBusinessMin) > 0.017;
    const afterHoursDiffers = myAfterHoursMin === null ? frozenStatus !== "NOT_CALCULABLE" : Math.abs(myAfterHoursMin - frozenAfterHoursMin) > 0.017;
    const statusDiffers = myCalcStatus !== frozenStatus;

    if (!businessDiffers && !afterHoursDiffers && !statusDiffers) { identical++; continue; }
    different++;

    const deltaSeconds = myAfterHoursMin !== null && frozenAfterHoursMin !== null && frozenAfterHoursMin !== undefined ? Math.round((myAfterHoursMin - frozenAfterHoursMin) * 60) : null;
    let category = "UNEXPLAINED";
    let subReason = null;
    let evidence = null;
    const durationMissing = durationMinutesRaw === null || durationMinutesRaw === undefined || Number(durationMinutesRaw) <= 0;

    if (durationMissing && frozenMethod === "PARTIAL_ESTIMATE" && frozenStatus === "CALCULATED_WITH_WARNINGS" && myCalcStatus === "NOT_CALCULABLE") {
      // Categoría cerrada preservada (SOURCE_DATA_CORRECTION, taxonomía de
      // exactamente 5 etiquetas, sin agregar una 6ª) -subreason específico
      // para este patrón: el legado ACEPTABA un status "calculado con
      // advertencias" sin exigir duration_minutes>0 en ese camino
      // (PARTIAL_ESTIMATE), mientras el cómputo real de intervalo sí lo
      // exige. Causa raíz real: dato fuente ausente (duration_minutes
      // NULL/0), no un defecto de nuestro motor.
      category = "SOURCE_DATA_CORRECTION";
      subReason = "LEGACY_ACCEPTED_MISSING_DURATION";
      evidence = `duration_minutes=${durationMinutesRaw} (ausente/cero); legado asigna PARTIAL_ESTIMATE/CALCULATED_WITH_WARNINGS sin intervalo calculable; motor corregido rechaza correctamente a NOT_CALCULABLE`;
    } else if (resolved.startTimeUtc && resolved.endTimeUtc) {
      const localDates = touchedLocalDates(resolved.startTimeUtc.getTime(), resolved.endTimeUtc.getTime());
      const holidayMismatches = localDates.filter(d => legacyHolidaySet.has(d) !== (governedHolidayLookup(d) === "CONFIRMED_HOLIDAY"));
      const dstDates = dstTransitionDates(localDates);
      if (holidayMismatches.length > 0) {
        category = "HOLIDAY_CALENDAR_DIFFERENCE";
        evidence = `fecha(s) local(es) con estado de feriado distinto entre calendario legado y calendario gobernado: ${holidayMismatches.join(", ")}`;
      } else if (dstDates.length > 0) {
        category = "DST_BOUNDARY_TASK";
        evidence = `intervalo toca fecha(s) de transición DST real en America/Santiago: ${dstDates.join(", ")}`;
      } else if (deltaSeconds !== null && Math.abs(deltaSeconds) <= 60 && !statusDiffers) {
        category = "ROUNDING_CORRECTION";
        evidence = `delta=${deltaSeconds}s, dentro de +-60s; el legado redondea cada campo independientemente antes de sumar`;
      }
    } else if (deltaSeconds !== null && Math.abs(deltaSeconds) <= 60 && !statusDiffers) {
      category = "ROUNDING_CORRECTION";
      evidence = `delta=${deltaSeconds}s, dentro de +-60s`;
    }

    categoryCounts[category]++;
    allDiffs.push({ taskId, category, subReason, evidence, deltaSeconds, myBusinessMin, frozenBusinessMin, myAfterHoursMin, frozenAfterHoursMin, myCalcStatus, frozenStatus });
  }

  return { compared, identical, different, categoryCounts, differences: allDiffs };
}

async function runParity(args) {
  const businessHoursCfg = JSON.parse(await fs.readFile("data/config/business-hours.json", "utf8"));
  const fixtures = await loadDuckDbFixtures();

  const out = { exact: null, corrected: null, verdict: null };

  if (args.parityMode === "exact" || args.parityMode === "both") {
    const legacyHolidaysRawExact = JSON.parse(await fs.readFile("data/config/holidays.example.json", "utf8"));
    const legacyHolidaysCfg = { ...legacyHolidaysRawExact, dates: new Set(legacyHolidaysRawExact.dates) };
    out.exact = await runParityExact(fixtures, businessHoursCfg, legacyHolidaysCfg);
    console.log("=== legacy_exact_parity (tolerancia cero) ===");
    console.log(`comparadas=${out.exact.compared} identicas=${out.exact.identical} diferentes=${out.exact.different}`);
  }

  if (args.parityMode === "corrected" || args.parityMode === "both") {
    const legacyHolidaysRaw = JSON.parse(await fs.readFile("data/config/holidays.example.json", "utf8"));
    const legacyHolidaySet = new Set(legacyHolidaysRaw.dates);
    const governed = await loadGovernedHolidays();
    out.corrected = await runParityCorrected(fixtures, businessHoursCfg, legacyHolidaySet, governed.lookup);
    console.log("=== legacy_corrected_v2 (diferencias clasificadas, taxonomía cerrada) ===");
    console.log(`comparadas=${out.corrected.compared} identicas=${out.corrected.identical} diferentes=${out.corrected.different}`);
    console.log("categorías:", JSON.stringify(out.corrected.categoryCounts, null, 2));
  }

  const exactBlocked = out.exact && out.exact.different > 0;
  const correctedBlocked = out.corrected && out.corrected.categoryCounts.UNEXPLAINED > 0;
  out.verdict = exactBlocked ? "BLOCKED_PARITY (legacy_exact_parity tiene diferencias)" : correctedBlocked ? "BLOCKED_PARITY (legacy_corrected_v2 tiene UNEXPLAINED>0)" : "PARITY_OK";
  console.log(`Veredicto de paridad: ${out.verdict}`);
  if (exactBlocked || correctedBlocked) process.exitCode = 1;
  return out;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const validation = validateArgs(args);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  switch (args.subcommand) {
    case "dry-run": return runDryRun(args);
    case "apply": return runApply(args);
    case "parity": return runParity(args);
    default: throw new Error(`Subcomando desconocido: ${args.subcommand}`);
  }
}

export { CLOSED_DIFF_CATEGORIES, runDryRun, runApply, runParity };

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(error => {
    console.error("ERROR:");
    console.error(error);
    process.exit(1);
  });
}
