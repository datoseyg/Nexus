import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";
import { mean, coefficientOfVariation } from "../lib/stats.js";
import { loadPolicy, loadEntity } from "../../business-rules/loaders/load-business-rules.js";
import { selectLifecycleModel } from "../models/lifecycle/lifecycle-model-selector.js";
import { calculateLifecyclePredictionConfidence, DEFAULT_CONFIDENCE_WEIGHTS } from "../models/lifecycle/lifecycle-prediction-confidence.js";

// GOLD "Vida Útil de Repuestos por Máquina" (ver
// docs/LIFECYCLE_PREDICTIVE_MODELS.md y docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md).
// Orden de cómputo IMPORTANTE: By_Part -> By_Client -> By_Machine, porque
// cada nivel usa el nivel más agregado ya calculado como cohorte para
// empirical-bayes shrinkage (ver cohort_priority en
// business-rules/policies/lifecycle-model-policy.json) - evita una
// segunda pasada de agregación separada.

const EVENTS_FILE = "data/marts/Equipment_Part_Lifecycle_Events.csv";
const INTERVALS_FILE = "data/marts/Equipment_Part_Lifecycle_Intervals.csv";
const LEGACY_MANUFACTURER_SPECS_FILE = "data/config/manufacturer_life_specs.csv";
const OUTPUT_DIR = "data/gold";
const BUILD_SUMMARY_FILE = "data/reports/equipment_part_lifecycle_gold_build_summary.json";

const MS_PER_DAY = 86400000;
const DAYS_PER_MONTH = 30.44;

const DEFAULT_LIFECYCLE_MODEL_POLICY = {
  default_model: "AUTO",
  minimum_intervals_for_direct_median: 3,
  minimum_intervals_for_weibull: 3,
  shrinkage_k: 5,
  allow_borrowed_estimates: true,
  cohort_priority: ["same_equipment_same_part", "same_client_same_part", "same_part_global", "same_part_family", "manufacturer_prior"],
  weibull: { shape_grid_min: 0.5, shape_grid_max: 5.0, shape_grid_steps: 60, scale_days_min: 30, scale_days_max: 3650, scale_grid_steps: 120, prior_strength: "moderate" },
  gamma_poisson: { prior_alpha: 1.0, prior_beta: 1.0 }
};

function round2(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

function pickDominant(counts) {
  let winner = null;
  let max = -1;
  for (const [key, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      winner = key;
    }
  }
  return winner;
}

// Fuente de vida útil de fabricante: preferida business-rules/entities/
// part_manufacturer_life.csv (real, si existe) - fallback al legacy
// data/config/manufacturer_life_specs.csv de la sesión anterior. Ninguna
// de las dos existe como archivo real todavía (solo .example.csv), así
// que en la práctica el mapa queda vacío hasta que el negocio complete
// alguna - nunca se inventa el dato.
async function loadManufacturerLifeMap() {
  const map = new Map();

  const legacyRows = await readCsv(LEGACY_MANUFACTURER_SPECS_FILE);
  for (const row of legacyRows) {
    const ref = String(row.dolibarr_ref ?? "").trim();
    if (!ref) continue;
    map.set(ref, { months: Number(row.manufacturer_life_months) || null, source: row.source || "LEGACY_CONFIG" });
  }

  const { rows: businessRuleRows, source } = await loadEntity("part_manufacturer_life");
  for (const row of businessRuleRows) {
    const ref = String(row.dolibarr_ref ?? "").trim();
    if (!ref) continue;
    map.set(ref, { months: Number(row.manufacturer_life_months) || null, source: row.manufacturer_source || "BUSINESS_RULES" });
  }

  return { map, businessRulesSource: source };
}

function resolveCohort(candidates) {
  for (const candidate of candidates) {
    if (candidate && candidate.estimateDays !== null && candidate.estimateDays !== undefined) {
      return candidate;
    }
  }
  return { estimateDays: null, source: null };
}

// Métricas comunes a los 3 niveles - selecciona el modelo estadístico
// (AUTO) y calcula la confiabilidad predictiva. `cohortCandidates` es una
// lista ordenada (mayor a menor prioridad) de { estimateDays, source } -
// se usa el primero disponible, igual que cohort_priority del policy.
function computeGroupMetrics({ eventsForKey, intervalsForKey, cohortCandidates, manufacturerEntry, policy, confidenceWeights }) {
  const observedEventCount = eventsForKey.length;

  const validIntervalRows = intervalsForKey.filter(r => r.interval_status !== "SINGLE_EVENT_ONLY");
  const intervalDays = validIntervalRows.map(r => Number(r.interval_days)).filter(v => Number.isFinite(v));

  const eventDates = eventsForKey.map(r => new Date(r.event_date).getTime()).filter(t => Number.isFinite(t));
  const firstObservedEventDate = eventDates.length ? new Date(Math.min(...eventDates)).toISOString() : "";
  const lastObservedEventDate = eventDates.length ? new Date(Math.max(...eventDates)).toISOString() : "";
  const coverageMonths = eventDates.length >= 2 ? (Math.max(...eventDates) - Math.min(...eventDates)) / MS_PER_DAY / DAYS_PER_MONTH : null;
  const coverageYears = coverageMonths !== null ? coverageMonths / 12 : null;

  const matchMethodCounts = {};
  const equipmentClarityCounts = { SINGLE: 0, MULTI: 0, NONE: 0 };
  let hasUsageHours = false;
  let totalBusinessMinutes = 0;
  let totalAfterHoursMinutes = 0;

  for (const event of eventsForKey) {
    const method = event.match_method || "NONE";
    matchMethodCounts[method] = (matchMethodCounts[method] || 0) + 1;

    const equipCount = Number(event.task_equipment_count) || 0;
    if (equipCount === 1) equipmentClarityCounts.SINGLE += 1;
    else if (equipCount > 1) equipmentClarityCounts.MULTI += 1;
    else equipmentClarityCounts.NONE += 1;

    if (event.business_minutes !== "" && event.business_minutes !== undefined && event.business_minutes !== null) {
      hasUsageHours = true;
      totalBusinessMinutes += Number(event.business_minutes) || 0;
      totalAfterHoursMinutes += Number(event.after_hours_minutes) || 0;
    }
  }

  const afterHoursRatio = (totalBusinessMinutes + totalAfterHoursMinutes) > 0
    ? totalAfterHoursMinutes / (totalBusinessMinutes + totalAfterHoursMinutes)
    : null;

  const dominantMatchMethod = pickDominant(matchMethodCounts) || "";
  const dominantEquipmentClarity = pickDominant(equipmentClarityCounts) || "NONE";
  const cv = intervalDays.length >= 2 ? coefficientOfVariation(intervalDays) : null;

  const cohort = resolveCohort(cohortCandidates);
  const manufacturerLifeMonths = manufacturerEntry?.months ?? null;

  const modelResult = selectLifecycleModel({
    intervalDays,
    observedEventCount,
    coverageYears,
    replacementCount: observedEventCount,
    exposureYears: coverageYears,
    cohortEstimateDays: cohort.estimateDays,
    cohortSource: cohort.source,
    manufacturerLifeMonths,
    requestedModel: policy.default_model,
    policy
  });

  const confidence = calculateLifecyclePredictionConfidence({
    nIntervals: modelResult.n_intervals,
    nEvents: modelResult.n_events,
    dominantMatchStatus: "MATCHED", // por construcción: solo eventos MATCHED llegan a este mart
    dominantMatchMethod,
    equipmentClarity: dominantEquipmentClarity,
    coverageMonths,
    coefficientOfVariation: cv,
    hasCohortEstimate: cohort.estimateDays !== null,
    hasUsageOrContractData: hasUsageHours,
    weibullPosteriorQualityStatus: modelResult.model_confidence_hint,
    modelFamily: modelResult.model_family
  }, confidenceWeights);

  let comparisonToManufacturer = "NO_MANUFACTURER_DATA";
  if (manufacturerLifeMonths && modelResult.estimated_life_months !== null) {
    const ratio = modelResult.estimated_life_months / manufacturerLifeMonths;
    if (ratio < 0.85) comparisonToManufacturer = "BELOW_MANUFACTURER_SPEC";
    else if (ratio > 1.15) comparisonToManufacturer = "ABOVE_MANUFACTURER_SPEC";
    else comparisonToManufacturer = "WITHIN_MANUFACTURER_SPEC";
  }

  const canPredictNextReplacement = !!lastObservedEventDate
    && modelResult.prediction_status !== "INSUFFICIENT_DATA"
    && modelResult.prediction_status !== "UNSTABLE_MODEL"
    && modelResult.estimated_life_days !== null;

  const predictedNextReplacementDate = canPredictNextReplacement
    ? new Date(new Date(lastObservedEventDate).getTime() + modelResult.estimated_life_days * MS_PER_DAY).toISOString()
    : "";

  return {
    first_observed_event_date: firstObservedEventDate,
    last_observed_event_date: lastObservedEventDate,
    observed_event_count: observedEventCount,
    valid_interval_count: intervalDays.length,
    avg_interval_days: round2(mean(intervalDays)),
    median_interval_days: modelResult.estimated_life_p50_days,
    selected_model: modelResult.selected_model,
    model_family: modelResult.model_family,
    model_reason: modelResult.model_reason,
    estimated_life_days: modelResult.estimated_life_days,
    estimated_life_months: modelResult.estimated_life_months,
    estimated_life_p10_days: modelResult.estimated_life_p10_days,
    estimated_life_p50_days: modelResult.estimated_life_p50_days,
    estimated_life_p90_days: modelResult.estimated_life_p90_days,
    credible_interval_low_days: modelResult.credible_interval_low_days,
    credible_interval_high_days: modelResult.credible_interval_high_days,
    machine_weight: modelResult.machine_weight,
    cohort_weight: modelResult.cohort_weight,
    cohort_source: modelResult.cohort_source,
    n_events: modelResult.n_events,
    n_intervals: modelResult.n_intervals,
    n_censored_observations: modelResult.n_censored_observations,
    replacement_rate_per_year: modelResult.estimated_life_days ? round2(365.25 / modelResult.estimated_life_days) : null,
    manufacturer_life_months: manufacturerLifeMonths,
    manufacturer_life_source: manufacturerEntry?.source ?? "NO_DATA",
    observed_vs_manufacturer_ratio: manufacturerLifeMonths && modelResult.estimated_life_months !== null ? round2(modelResult.estimated_life_months / manufacturerLifeMonths) : null,
    predicted_next_replacement_date: predictedNextReplacementDate,
    prediction_status: modelResult.prediction_status,
    comparison_to_manufacturer: comparisonToManufacturer,
    model_confidence_score: confidence.score,
    model_confidence_label: confidence.label,
    model_confidence_factors: confidence.factors,
    statistical_notes: modelResult.statistical_notes || "",
    // Alias de compatibilidad con la vista/consumidores de la sesión
    // anterior (nombres previos a esta iteración) - evita romper el
    // frontend existente mientras se termina de migrar a los nombres
    // nuevos de la Parte 9.
    estimate_status: modelResult.prediction_status,
    lifecycle_confidence_score: confidence.score,
    lifecycle_confidence_label: confidence.label,
    lifecycle_confidence_factors: confidence.factors,
    min_interval_days: intervalDays.length ? Math.min(...intervalDays) : null,
    max_interval_days: intervalDays.length ? Math.max(...intervalDays) : null,
    stddev_interval_days: null,
    p25_interval_days: null,
    p75_interval_days: null,
    estimated_life_method: modelResult.selected_model,
    after_hours_ratio: afterHoursRatio !== null ? round2(afterHoursRatio) : null,
    notes: observedEventCount === 1 ? "Solo un evento observado para esta combinación - no se puede estimar vida útil todavía sin cohorte." : ""
  };
}

function buildAggregateTable(usableEvents, intervalRows, keyFn, labelFieldsFn, cohortResolverFn, manufacturerMap, policy, confidenceWeights) {
  const eventGroups = new Map();
  for (const event of usableEvents) {
    const key = keyFn(event);
    if (!key) continue;
    if (!eventGroups.has(key)) eventGroups.set(key, []);
    eventGroups.get(key).push(event);
  }

  const intervalGroups = new Map();
  for (const interval of intervalRows) {
    const key = keyFn(interval);
    if (!key) continue;
    if (!intervalGroups.has(key)) intervalGroups.set(key, []);
    intervalGroups.get(key).push(interval);
  }

  const rows = [];
  const byKey = new Map();

  for (const [key, eventsForKey] of eventGroups.entries()) {
    const intervalsForKey = intervalGroups.get(key) || [];
    const labelFields = labelFieldsFn(eventsForKey[0]);
    const dolibarrRef = labelFields.dolibarr_ref;
    const manufacturerEntry = manufacturerMap.get(dolibarrRef);
    const cohortCandidates = cohortResolverFn(labelFields, byKey);

    const metrics = computeGroupMetrics({ eventsForKey, intervalsForKey, cohortCandidates, manufacturerEntry, policy, confidenceWeights });
    const row = { ...labelFields, ...metrics };
    rows.push(row);
    byKey.set(key, row);
  }

  return { rows: rows.sort((a, b) => (b.observed_event_count || 0) - (a.observed_event_count || 0)), byKey };
}

function buildInsights(byMachineRows, byPartByRef) {
  const insights = [];

  for (const row of byMachineRows) {
    if (row.prediction_status === "INSUFFICIENT_DATA") {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "LOW_DATA_VOLUME",
        insight_text: row.observed_event_count === 1
          ? "Solo existe un evento observado para este repuesto en esta máquina - no hay base estadística suficiente todavía."
          : "No hay base estadística suficiente para estimar vida útil de este repuesto en esta máquina.",
        severity: "info"
      });
    } else if (row.n_intervals < 3) {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "LOW_DATA_VOLUME",
        insight_text: `La estimación tiene confiabilidad reducida por n < 3 (${row.n_intervals} intervalo(s) propios). ${row.model_reason}`,
        severity: "warning"
      });
    }

    if (row.model_confidence_factors?.includes("match exacto/alias")) {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "MATCH_QUALITY",
        insight_text: "El match con Dolibarr es exacto, lo que aumenta la confiabilidad de esta estimación.",
        severity: "positive"
      });
    }

    if (row.model_confidence_factors?.includes("asociación multi")) {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "ASSOCIATION_QUALITY",
        insight_text: "La asociación repuesto-máquina proviene de una task con múltiples equipos, lo que reduce la confiabilidad de esta estimación.",
        severity: "warning"
      });
    }

    if (row.model_family === "BORROWED_COHORT_ESTIMATE" || row.model_family === "LOW_N_SHRINKAGE") {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "COHORT_USED",
        insight_text: `El modelo usa cohorte (${row.cohort_source ?? "nivel superior"}) porque no hay suficientes eventos propios en esta máquina.`,
        severity: "info"
      });
    }

    if (row.comparison_to_manufacturer === "BELOW_MANUFACTURER_SPEC") {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "BELOW_MANUFACTURER",
        insight_text: "La vida útil observada es menor que la referencia de fabricante - no implica una causa específica, es solo una comparación descriptiva.",
        severity: "warning"
      });
    }

    const globalRow = byPartByRef.get(row.dolibarr_ref);
    if (globalRow && globalRow.estimated_life_days && row.estimated_life_days && row.prediction_status === "DIRECT_HISTORY_ENOUGH") {
      if (row.estimated_life_days < globalRow.estimated_life_days * 0.8) {
        insights.push({
          equipment_internal_id: row.equipment_internal_id,
          dolibarr_ref: row.dolibarr_ref,
          insight_type: "BELOW_GLOBAL_AVERAGE",
          insight_text: "Este repuesto presenta menor duración observada que el promedio global - no implica una causa específica, es solo una comparación descriptiva.",
          severity: "warning"
        });
      } else if (row.estimated_life_days > globalRow.estimated_life_days * 1.2) {
        insights.push({
          equipment_internal_id: row.equipment_internal_id,
          dolibarr_ref: row.dolibarr_ref,
          insight_type: "ABOVE_GLOBAL_AVERAGE",
          insight_text: "Este repuesto presenta mayor duración observada que el promedio global.",
          severity: "positive"
        });
      }
    }

    if (Number(row.after_hours_ratio) > 0.3) {
      insights.push({
        equipment_internal_id: row.equipment_internal_id,
        dolibarr_ref: row.dolibarr_ref,
        insight_type: "AFTER_HOURS_EXPOSURE",
        insight_text: "La máquina presenta actividad fuera de horario relevante; esto podría ser un factor explicativo, pero no prueba causalidad.",
        severity: "info"
      });
    }
  }

  return insights;
}

async function buildEquipmentPartLifecycleGold() {
  console.log("=== Construyendo GOLD Vida Útil de Repuestos por Máquina (motor de modelos AUTO) ===");

  const allEvents = await readCsv(EVENTS_FILE);
  const intervalRows = await readCsv(INTERVALS_FILE);
  const { map: manufacturerMap, businessRulesSource } = await loadManufacturerLifeMap();
  const policy = await loadPolicy("lifecycle-model-policy", DEFAULT_LIFECYCLE_MODEL_POLICY);
  const confidenceWeights = await loadPolicy("confidence-weights", DEFAULT_CONFIDENCE_WEIGHTS);

  const usableEvents = allEvents.filter(e => e.match_status === "MATCHED" && e.calculation_status === "OK");
  console.log(`Eventos usables: ${usableEvents.length} de ${allEvents.length} totales`);
  console.log(`Filas de intervalo: ${intervalRows.length}`);
  console.log(`Vida útil de fabricante: ${manufacturerMap.size} referencias cargadas (business-rules entity source: ${businessRulesSource})`);

  // 1) By_Part (global) - cohorte = manufacturer_prior únicamente en v1.
  // "same_part_family" del cohort_priority no está implementado todavía:
  // requeriría agrupar por business-rules/entities/part_families.csv, que
  // hoy solo tiene la fila de ejemplo (.example.csv) - no hay agrupación
  // real que pooler. Documentado en docs/LIFECYCLE_PREDICTIVE_MODELS.md.
  const byPart = buildAggregateTable(
    usableEvents, intervalRows,
    r => r.dolibarr_ref || null,
    first => ({ dolibarr_ref: first.dolibarr_ref, dolibarr_label: first.dolibarr_label }),
    labelFields => {
      const manufacturerEntry = manufacturerMap.get(labelFields.dolibarr_ref);
      const manufacturerDays = manufacturerEntry?.months ? manufacturerEntry.months * DAYS_PER_MONTH : null;
      return [{ estimateDays: manufacturerDays, source: "manufacturer_prior" }];
    },
    manufacturerMap, policy, confidenceWeights
  );

  // 2) By_Client - cohorte = By_Part (mismo repuesto, global) -> manufacturer_prior.
  const byPartByRef = new Map(byPart.rows.map(r => [r.dolibarr_ref, r]));

  const byClient = buildAggregateTable(
    usableEvents, intervalRows,
    r => (r.client_name && r.dolibarr_ref ? `${r.client_name}||${r.dolibarr_ref}` : null),
    first => ({ client_name: first.client_name, dolibarr_ref: first.dolibarr_ref, dolibarr_label: first.dolibarr_label }),
    labelFields => {
      const partRow = byPartByRef.get(labelFields.dolibarr_ref);
      const manufacturerEntry = manufacturerMap.get(labelFields.dolibarr_ref);
      const manufacturerDays = manufacturerEntry?.months ? manufacturerEntry.months * DAYS_PER_MONTH : null;
      return [
        { estimateDays: partRow?.estimated_life_days ?? null, source: "same_part_global" },
        { estimateDays: manufacturerDays, source: "manufacturer_prior" }
      ];
    },
    manufacturerMap, policy, confidenceWeights
  );

  // 3) By_Machine - cohorte = By_Client (mismo repuesto, mismo cliente) -> By_Part -> manufacturer_prior.
  const byClientByKey = new Map(byClient.rows.map(r => [`${r.client_name}||${r.dolibarr_ref}`, r]));

  const byMachine = buildAggregateTable(
    usableEvents, intervalRows,
    r => (r.equipment_internal_id && r.dolibarr_ref ? `${r.equipment_internal_id}||${r.dolibarr_ref}` : null),
    first => ({ equipment_internal_id: first.equipment_internal_id, client_name: first.client_name, dolibarr_ref: first.dolibarr_ref, dolibarr_label: first.dolibarr_label }),
    labelFields => {
      const clientRow = byClientByKey.get(`${labelFields.client_name}||${labelFields.dolibarr_ref}`);
      const partRow = byPartByRef.get(labelFields.dolibarr_ref);
      const manufacturerEntry = manufacturerMap.get(labelFields.dolibarr_ref);
      const manufacturerDays = manufacturerEntry?.months ? manufacturerEntry.months * DAYS_PER_MONTH : null;
      return [
        { estimateDays: clientRow?.estimated_life_days ?? null, source: "same_client_same_part" },
        { estimateDays: partRow?.estimated_life_days ?? null, source: "same_part_global" },
        { estimateDays: manufacturerDays, source: "manufacturer_prior" }
      ];
    },
    manufacturerMap, policy, confidenceWeights
  );

  const insightsRows = buildInsights(byMachine.rows, byPartByRef);

  const predictionStatusBreakdown = {};
  const confidenceLabelBreakdown = {};
  for (const row of byMachine.rows) {
    predictionStatusBreakdown[row.prediction_status] = (predictionStatusBreakdown[row.prediction_status] || 0) + 1;
    confidenceLabelBreakdown[row.model_confidence_label] = (confidenceLabelBreakdown[row.model_confidence_label] || 0) + 1;
  }

  const summaryRows = [
    {
      generated_at: new Date().toISOString(),
      total_machine_part_combinations: byMachine.rows.length,
      total_machines_analyzed: new Set(byMachine.rows.map(r => r.equipment_internal_id)).size,
      total_parts_analyzed: new Set(byMachine.rows.map(r => r.dolibarr_ref)).size,
      total_clients_analyzed: new Set(byMachine.rows.map(r => r.client_name)).size,
      prediction_status_breakdown: JSON.stringify(predictionStatusBreakdown),
      confidence_label_breakdown: JSON.stringify(confidenceLabelBreakdown),
      total_insights_generated: insightsRows.length,
      lifecycle_model_policy_default: policy.default_model
    }
  ];

  const outputs = [
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Part_Lifecycle_Summary.csv`, rows: summaryRows },
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Part_Lifecycle_By_Machine.csv`, rows: byMachine.rows },
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Part_Lifecycle_By_Client.csv`, rows: byClient.rows },
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Part_Lifecycle_By_Part.csv`, rows: byPart.rows },
    { file: `${OUTPUT_DIR}/GOLD_Equipment_Part_Lifecycle_Insights.csv`, rows: insightsRows }
  ];

  for (const output of outputs) {
    await writeCsv(output.file, output.rows);
  }

  const buildSummary = {
    generated_at: new Date().toISOString(),
    inputs_used: [EVENTS_FILE, INTERVALS_FILE, LEGACY_MANUFACTURER_SPECS_FILE, "business-rules/entities/part_manufacturer_life.csv (si existe)", "business-rules/policies/lifecycle-model-policy.json"],
    outputs: outputs.map(o => ({ file: o.file, row_count: o.rows.length })),
    prediction_status_breakdown: predictionStatusBreakdown,
    confidence_label_breakdown: confidenceLabelBreakdown
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(BUILD_SUMMARY_FILE, JSON.stringify(buildSummary, null, 2), "utf8");

  console.log(JSON.stringify(buildSummary, null, 2));
  console.log(`Resumen de build guardado en ${BUILD_SUMMARY_FILE}`);
  console.log("=== GOLD Vida Útil de Repuestos por Máquina finalizado ===");
}

buildEquipmentPartLifecycleGold().catch(error => {
  console.error("ERROR CONSTRUYENDO GOLD VIDA ÚTIL DE REPUESTOS:");
  console.error(error);
  process.exit(1);
});
