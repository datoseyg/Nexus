// Modelo de confiabilidad METODOLÓGICA (no probabilidad estadística) para
// el motor de modelos predictivos de vida útil (src/models/lifecycle/*).
// 9 factores + penalizaciones, ponderados por
// business-rules/policies/confidence-weights.json (o el fallback embebido
// acá si ese archivo no existe). Reusa los tiers Alta/Media/Baja/
// Insuficiente de src/lib/calculation-confidence.js - no se redefinen acá.
//
// Reemplaza el consumo de src/lib/lifecycle-confidence.js (7 factores,
// sesión anterior) dentro de esta línea - ese archivo queda intacto, sin
// nuevos consumidores, no se borra.

import { getConfidenceLabel, getConfidenceColor } from "../../lib/calculation-confidence.js";

export const DEFAULT_CONFIDENCE_WEIGHTS = {
  factors: {
    n_intervals: 20,
    match_quality: 12,
    equipment_association: 12,
    temporal_coverage: 12,
    interval_consistency: 10,
    cohort_availability: 12,
    usage_or_contract_data: 8,
    weibull_stability: 8,
    estimate_directness: 6
  },
  penalties: {
    n_less_than_10: -10,
    n_less_than_3: -20,
    borrowed_estimate: -8,
    no_contract_or_usage_data: -5,
    multi_equipment_association: -8
  }
};

const STRONG_MATCH_METHODS = new Set([
  "REF_EXACT", "BARCODE_EXACT", "ID_EXACT",
  "REF_NORMALIZED_EXACT", "BARCODE_NORMALIZED_EXACT", "MANUAL_ALIAS_EXACT"
]);

function clampScore(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

// context = {
//   nIntervals, nEvents, dominantMatchStatus, dominantMatchMethod,
//   equipmentClarity: "SINGLE"|"MULTI"|"NONE",
//   coverageMonths, coefficientOfVariation,
//   hasCohortEstimate, hasUsageOrContractData,
//   weibullPosteriorQualityStatus: "STABLE"|"PRIOR_DOMINATED"|"UNSTABLE_POSTERIOR"|null,
//   modelFamily
// }
export function calculateLifecyclePredictionConfidence(context, weights = DEFAULT_CONFIDENCE_WEIGHTS) {
  const f = weights.factors;
  const p = weights.penalties;
  const factorDetails = [];
  let score = 0;

  // 1) n_intervals
  const n = Number(context.nIntervals) || 0;
  let nPoints;
  if (n >= 10) nPoints = f.n_intervals;
  else if (n >= 5) nPoints = f.n_intervals * 0.75;
  else if (n >= 3) nPoints = f.n_intervals * 0.5;
  else if (n >= 1) nPoints = f.n_intervals * 0.25;
  else nPoints = 0;
  score += nPoints;
  factorDetails.push({ factor: "n_intervals", points: round1(nPoints), max: f.n_intervals, reason: `${n} intervalo(s) válidos` });

  // 2) calidad de match Dolibarr
  const matchStatus = context.dominantMatchStatus || "NO_MATCH";
  const matchMethod = context.dominantMatchMethod || "";
  let matchPoints;
  let matchReason;
  if (matchStatus === "MATCHED" && STRONG_MATCH_METHODS.has(matchMethod)) {
    matchPoints = f.match_quality;
    matchReason = `match exacto/alias (${matchMethod})`;
  } else if (matchStatus === "MATCHED") {
    matchPoints = f.match_quality * (2 / 3);
    matchReason = `match por método débil (${matchMethod || "desconocido"})`;
  } else if (matchStatus === "AMBIGUOUS_MATCH") {
    matchPoints = f.match_quality * 0.25;
    matchReason = "match ambiguo";
  } else {
    matchPoints = 0;
    matchReason = `sin match confiable (${matchStatus})`;
  }
  score += matchPoints;
  factorDetails.push({ factor: "calidad_match", points: round1(matchPoints), max: f.match_quality, reason: matchReason });

  // 3) asociación máquina-repuesto
  const clarity = context.equipmentClarity || "NONE";
  let clarityPoints;
  if (clarity === "SINGLE") clarityPoints = f.equipment_association;
  else if (clarity === "MULTI") clarityPoints = f.equipment_association * (5 / 12);
  else clarityPoints = 0;
  score += clarityPoints;
  factorDetails.push({ factor: "asociacion_maquina_repuesto", points: round1(clarityPoints), max: f.equipment_association, reason: `asociación ${clarity.toLowerCase()}` });

  // 4) cobertura temporal
  const coverageMonths = context.coverageMonths;
  let coveragePoints;
  if (coverageMonths === null || coverageMonths === undefined) coveragePoints = 0;
  else if (coverageMonths > 24) coveragePoints = f.temporal_coverage;
  else if (coverageMonths >= 12) coveragePoints = f.temporal_coverage * (2 / 3);
  else coveragePoints = f.temporal_coverage * (1 / 3);
  score += coveragePoints;
  factorDetails.push({ factor: "cobertura_temporal", points: round1(coveragePoints), max: f.temporal_coverage, reason: coverageMonths ? `${Math.round(coverageMonths)} meses de cobertura` : "sin cobertura calculable" });

  // 5) consistencia de intervalos (coeficiente de variación)
  const cv = context.coefficientOfVariation;
  let cvPoints;
  if (cv === null || cv === undefined) cvPoints = 0;
  else if (cv <= 0.3) cvPoints = f.interval_consistency;
  else if (cv <= 0.7) cvPoints = f.interval_consistency * 0.6;
  else cvPoints = f.interval_consistency * 0.2;
  score += cvPoints;
  factorDetails.push({ factor: "consistencia_intervalos", points: round1(cvPoints), max: f.interval_consistency, reason: cv !== null && cv !== undefined ? `coeficiente de variación ${cv.toFixed(2)}` : "sin intervalos suficientes" });

  // 6) existencia de cohort estimate
  const cohortPoints = context.hasCohortEstimate ? f.cohort_availability : 0;
  score += cohortPoints;
  factorDetails.push({ factor: "disponibilidad_cohorte", points: round1(cohortPoints), max: f.cohort_availability, reason: context.hasCohortEstimate ? "hay estimación de cohorte disponible" : "sin cohorte disponible" });

  // 7) datos de uso/contrato/horario
  const usagePoints = context.hasUsageOrContractData ? f.usage_or_contract_data : 0;
  score += usagePoints;
  factorDetails.push({ factor: "datos_uso_contrato", points: round1(usagePoints), max: f.usage_or_contract_data, reason: context.hasUsageOrContractData ? "hay datos de uso/contrato/horario" : "sin datos de uso/contrato/horario" });

  // 8) estabilidad del modelo Weibull
  const weibullStatus = context.weibullPosteriorQualityStatus;
  let weibullPoints;
  if (weibullStatus === "STABLE") weibullPoints = f.weibull_stability;
  else if (weibullStatus === "PRIOR_DOMINATED") weibullPoints = f.weibull_stability * (3 / 8);
  else if (weibullStatus === "UNSTABLE_POSTERIOR") weibullPoints = 0;
  else weibullPoints = f.weibull_stability * 0.5; // no se intentó Weibull - neutral, no penaliza
  score += weibullPoints;
  factorDetails.push({ factor: "estabilidad_weibull", points: round1(weibullPoints), max: f.weibull_stability, reason: weibullStatus || "Weibull no evaluado (n insuficiente)" });

  // 9) directo vs. prestado
  const modelFamily = context.modelFamily || "INSUFFICIENT_DATA";
  let directnessPoints;
  if (modelFamily === "DIRECT_HISTORY_ENOUGH") directnessPoints = f.estimate_directness;
  else if (modelFamily === "LOW_N_SHRINKAGE" || modelFamily === "RATE_MODEL_ESTIMATE") directnessPoints = f.estimate_directness * 0.5;
  else if (modelFamily === "BORROWED_COHORT_ESTIMATE") directnessPoints = f.estimate_directness * (1 / 6);
  else directnessPoints = 0;
  score += directnessPoints;
  factorDetails.push({ factor: "directo_vs_prestado", points: round1(directnessPoints), max: f.estimate_directness, reason: `estimación de tipo ${modelFamily}` });

  // Penalizaciones (no son factores con "max" propio - restan directo).
  const isBorrowed = modelFamily === "BORROWED_COHORT_ESTIMATE";
  if (n < 10) {
    score += p.n_less_than_10;
    factorDetails.push({ factor: "penalizacion_n<10", points: p.n_less_than_10, max: 0, reason: `n=${n} intervalos (<10)` });
  }
  if (n < 3) {
    score += p.n_less_than_3;
    factorDetails.push({ factor: "penalizacion_n<3", points: p.n_less_than_3, max: 0, reason: `n=${n} intervalos (<3)` });
  }
  if (isBorrowed) {
    score += p.borrowed_estimate;
    factorDetails.push({ factor: "penalizacion_borrowed", points: p.borrowed_estimate, max: 0, reason: "estimación prestada de cohorte" });
  }
  if (!context.hasUsageOrContractData) {
    score += p.no_contract_or_usage_data;
    factorDetails.push({ factor: "penalizacion_sin_contrato", points: p.no_contract_or_usage_data, max: 0, reason: "sin contrato/perfil de uso" });
  }
  if (clarity === "MULTI") {
    score += p.multi_equipment_association;
    factorDetails.push({ factor: "penalizacion_multi_equipo", points: p.multi_equipment_association, max: 0, reason: "asociación desde task con múltiples equipos" });
  }

  const clampedScore = clampScore(score);
  const { label } = getConfidenceLabel(clampedScore);

  return {
    score: clampedScore,
    label,
    color: getConfidenceColor(clampedScore),
    factors: factorDetails.map(d => `${d.reason} (${d.points >= 0 ? "+" : ""}${d.points})`).join(" | "),
    factorDetails
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
