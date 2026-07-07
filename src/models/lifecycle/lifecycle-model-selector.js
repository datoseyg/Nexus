import { runEmpiricalIntervalModel } from "./empirical-interval-model.js";
import { runEmpiricalBayesShrinkage } from "./empirical-bayes-shrinkage.js";
import { runBayesianWeibullGrid } from "./bayesian-weibull-grid.js";
import { runGammaPoissonRateModel } from "./gamma-poisson-rate-model.js";
import { median } from "../../lib/stats.js";

const DAYS_PER_MONTH = 30.44;

function toMonths(days) {
  return days === null || days === undefined ? null : days / DAYS_PER_MONTH;
}

// Orquesta el árbol de decisión "AUTO" descrito en
// docs/LIFECYCLE_PREDICTIVE_MODELS.md § modelo AUTO. No decide de dónde
// viene `cohortEstimateDays` (eso lo resuelve el caller - gold builder -
// siguiendo `cohort_priority` de business-rules/policies/lifecycle-model-policy.json).
//
// Precedencia (siguiendo las reglas del usuario, con una extensión
// documentada): n>=minimo_directo -> empírico/Weibull > n en [1, minimo)
// con cohorte -> shrinkage > n en [1, minimo) sin cohorte pero con
// ventana de exposición -> tasa Gamma-Poisson (extensión: más principista
// que una mediana de 1-2 datos sueltos) > n en [1, minimo) sin cohorte ni
// exposición -> mediana directa de baja confianza > 1 evento sin
// intervalo con cohorte -> shrinkage 100% cohorte (borrowed) > sin
// cohorte ni exposición -> INSUFFICIENT_DATA.
//
// input = {
//   intervalDays: number[], observedEventCount: number,
//   coverageYears: number|null, replacementCount: number, exposureYears: number|null,
//   cohortEstimateDays: number|null, cohortSource: string|null,
//   manufacturerLifeMonths: number|null, requestedModel: string|undefined, policy
// }
export function selectLifecycleModel(input) {
  const { intervalDays, observedEventCount, cohortEstimateDays, cohortSource, exposureYears, replacementCount, manufacturerLifeMonths, policy } = input;
  const requestedModel = input.requestedModel && input.requestedModel !== "AUTO" ? input.requestedModel : null;

  const n = intervalDays.length;
  const k = policy.shrinkage_k;
  const minDirect = policy.minimum_intervals_for_direct_median;
  const minWeibull = policy.minimum_intervals_for_weibull;
  const gammaPoissonPrior = policy.gamma_poisson || { prior_alpha: 1, prior_beta: 365 };

  const manufacturerRatio = manufacturerLifeMonths
    ? { manufacturer_life_months: manufacturerLifeMonths }
    : { manufacturer_life_months: null };

  function buildResult({ selectedModel, modelFamily, predictionStatus, estimateDays, extra = {}, reason, notes }) {
    const estimateMonths = toMonths(estimateDays);
    return {
      selected_model: selectedModel,
      model_family: modelFamily,
      model_reason: reason,
      estimated_life_days: estimateDays !== null && estimateDays !== undefined ? Math.round(estimateDays * 100) / 100 : null,
      estimated_life_months: estimateMonths !== null ? Math.round(estimateMonths * 100) / 100 : null,
      estimated_life_p10_days: extra.p10_days ?? null,
      estimated_life_p50_days: extra.p50_days ?? (estimateDays ?? null),
      estimated_life_p90_days: extra.p90_days ?? null,
      credible_interval_low_days: extra.credible_interval_low_days ?? extra.p10_days ?? null,
      credible_interval_high_days: extra.credible_interval_high_days ?? extra.p90_days ?? null,
      machine_weight: extra.machine_weight ?? null,
      cohort_weight: extra.cohort_weight ?? null,
      cohort_source: extra.cohort_source ?? null,
      n_events: observedEventCount,
      n_intervals: n,
      n_censored_observations: 0, // no se modela censura en v1 - ver docs/LIFECYCLE_PREDICTIVE_MODELS.md § limitaciones
      ...manufacturerRatio,
      prediction_status: predictionStatus,
      model_confidence_hint: extra.posterior_quality_status ?? null,
      statistical_notes: notes ?? ""
    };
  }

  // --- Modo forzado por el usuario (selector de modelo en la UI) ---
  if (requestedModel === "MEDIAN_INTERVAL" || requestedModel === "TRIMMED_MEAN_INTERVAL") {
    if (n === 0) {
      return buildResult({ selectedModel: requestedModel, modelFamily: "INSUFFICIENT_DATA", predictionStatus: "INSUFFICIENT_DATA", estimateDays: null, reason: "Modelo forzado a mediana empírica, pero no hay intervalos observados." });
    }
    const empirical = runEmpiricalIntervalModel(intervalDays);
    return buildResult({
      selectedModel: empirical.model_name,
      modelFamily: n >= minDirect ? "DIRECT_HISTORY_ENOUGH" : "LOW_N_SHRINKAGE",
      predictionStatus: n >= minDirect ? "DIRECT_HISTORY_ENOUGH" : "LOW_N_SHRINKAGE",
      estimateDays: empirical.median_days,
      extra: { p10_days: empirical.p10_days, p50_days: empirical.p50_days, p90_days: empirical.p90_days },
      reason: `Modelo forzado por el usuario (mediana empírica sobre ${n} intervalo(s)).`
    });
  }

  if (requestedModel === "EMPIRICAL_BAYES_SHRINKAGE") {
    if (!cohortEstimateDays) {
      return buildResult({ selectedModel: requestedModel, modelFamily: "INSUFFICIENT_DATA", predictionStatus: "INSUFFICIENT_DATA", estimateDays: null, reason: "Modelo forzado a shrinkage, pero no hay cohorte disponible para combinar." });
    }
    const machineEstimate = n > 0 ? median(intervalDays) : null;
    const shrink = runEmpiricalBayesShrinkage({ machineEstimateDays: machineEstimate, cohortEstimateDays, nIntervals: n, k, cohortSource });
    return buildResult({
      selectedModel: shrink.model_name,
      modelFamily: "LOW_N_SHRINKAGE",
      predictionStatus: "LOW_N_SHRINKAGE",
      estimateDays: shrink.estimate_days,
      extra: { machine_weight: shrink.machine_weight, cohort_weight: shrink.cohort_weight, cohort_source: shrink.cohort_source },
      reason: `Modelo forzado por el usuario. ${shrink.notes}`
    });
  }

  if (requestedModel === "BAYESIAN_WEIBULL_GRID") {
    const weibull = runBayesianWeibullGrid(intervalDays, policy, cohortEstimateDays);
    return buildResult({
      selectedModel: weibull.model_name,
      modelFamily: n >= minDirect ? "DIRECT_HISTORY_ENOUGH" : "LOW_N_SHRINKAGE",
      predictionStatus: weibull.posterior_quality_status === "STABLE" ? "DIRECT_HISTORY_ENOUGH" : "UNSTABLE_MODEL",
      estimateDays: weibull.median_life_days,
      extra: {
        p10_days: weibull.p10_life_days, p50_days: weibull.p50_life_days, p90_days: weibull.p90_life_days,
        credible_interval_low_days: weibull.credible_interval_low_days, credible_interval_high_days: weibull.credible_interval_high_days,
        posterior_quality_status: weibull.posterior_quality_status
      },
      reason: `Modelo forzado por el usuario. ${weibull.notes}`
    });
  }

  if (requestedModel === "GAMMA_POISSON_RATE_MODEL") {
    if (!(exposureYears > 0)) {
      return buildResult({ selectedModel: requestedModel, modelFamily: "INSUFFICIENT_DATA", predictionStatus: "INSUFFICIENT_DATA", estimateDays: null, reason: "Modelo forzado a tasa Gamma-Poisson, pero no hay ventana de exposición observable." });
    }
    const rate = runGammaPoissonRateModel({ replacementCount, exposureYears, priorAlpha: gammaPoissonPrior.prior_alpha, priorBeta: gammaPoissonPrior.prior_beta });
    return buildResult({
      selectedModel: rate.model_name,
      modelFamily: "RATE_MODEL_ESTIMATE",
      predictionStatus: "RATE_MODEL_ESTIMATE",
      estimateDays: rate.expected_life_days,
      extra: { credible_interval_low_days: rate.credible_interval_low_days, credible_interval_high_days: rate.credible_interval_high_days },
      reason: `Modelo forzado por el usuario. ${rate.notes}`
    });
  }

  // --- AUTO ---

  // 1) Suficiente historial propio.
  if (n >= minDirect) {
    const empirical = runEmpiricalIntervalModel(intervalDays);
    const weibull = n >= minWeibull ? runBayesianWeibullGrid(intervalDays, policy, cohortEstimateDays) : null;

    if (weibull && weibull.posterior_quality_status === "STABLE") {
      return buildResult({
        selectedModel: weibull.model_name,
        modelFamily: "DIRECT_HISTORY_ENOUGH",
        predictionStatus: "DIRECT_HISTORY_ENOUGH",
        estimateDays: weibull.median_life_days,
        extra: {
          p10_days: weibull.p10_life_days, p50_days: weibull.p50_life_days, p90_days: weibull.p90_life_days,
          credible_interval_low_days: weibull.credible_interval_low_days, credible_interval_high_days: weibull.credible_interval_high_days,
          posterior_quality_status: weibull.posterior_quality_status
        },
        reason: `Suficiente historial propio (n=${n} intervalos): se ajustó un Weibull bayesiano estable.`,
        notes: weibull.notes
      });
    }

    return buildResult({
      selectedModel: empirical.model_name,
      modelFamily: "DIRECT_HISTORY_ENOUGH",
      predictionStatus: "DIRECT_HISTORY_ENOUGH",
      estimateDays: empirical.model_name === "TRIMMED_MEAN_INTERVAL" ? empirical.trimmed_mean_days : empirical.median_days,
      extra: { p10_days: empirical.p10_days, p50_days: empirical.p50_days, p90_days: empirical.p90_days },
      reason: weibull
        ? `Suficiente historial propio (n=${n}), pero el ajuste Weibull no fue estable (posterior en el borde del grid) - se usa ${empirical.model_name === "TRIMMED_MEAN_INTERVAL" ? "la media recortada" : "la mediana"} empírica.`
        : `Suficiente historial propio (n=${n}): se usa ${empirical.model_name === "TRIMMED_MEAN_INTERVAL" ? "la media recortada" : "la mediana"} empírica de los intervalos.`
    });
  }

  // 2) n en [1, minDirect) - shrinkage hacia cohorte si existe.
  if (n >= 1) {
    const machineEstimate = median(intervalDays);

    if (cohortEstimateDays) {
      const shrink = runEmpiricalBayesShrinkage({ machineEstimateDays: machineEstimate, cohortEstimateDays, nIntervals: n, k, cohortSource });
      return buildResult({
        selectedModel: shrink.model_name,
        modelFamily: "LOW_N_SHRINKAGE",
        predictionStatus: "LOW_N_SHRINKAGE",
        estimateDays: shrink.estimate_days,
        extra: { machine_weight: shrink.machine_weight, cohort_weight: shrink.cohort_weight, cohort_source: shrink.cohort_source },
        reason: shrink.notes
      });
    }

    // Sin cohorte pero con ventana de exposición real (>=2 eventos ya
    // implican una ventana observada) - la tasa Gamma-Poisson es más
    // principista que una mediana de 1-2 datos sueltos (extensión
    // documentada sobre la regla 2 del usuario, ver docs/LIFECYCLE_PREDICTIVE_MODELS.md).
    if (exposureYears > 0) {
      const rate = runGammaPoissonRateModel({ replacementCount, exposureYears, priorAlpha: gammaPoissonPrior.prior_alpha, priorBeta: gammaPoissonPrior.prior_beta });
      if (rate) {
        return buildResult({
          selectedModel: rate.model_name,
          modelFamily: "RATE_MODEL_ESTIMATE",
          predictionStatus: "RATE_MODEL_ESTIMATE",
          estimateDays: rate.expected_life_days,
          extra: { credible_interval_low_days: rate.credible_interval_low_days, credible_interval_high_days: rate.credible_interval_high_days },
          reason: `Solo ${n} intervalo(s) propio(s) y sin cohorte disponible - se usa la tasa de reemplazo observada (Gamma-Poisson) en vez de una mediana de muy pocos datos. ${rate.notes}`
        });
      }
    }

    return buildResult({
      selectedModel: "MEDIAN_INTERVAL",
      modelFamily: "LOW_N_SHRINKAGE",
      predictionStatus: "LOW_N_SHRINKAGE",
      estimateDays: machineEstimate,
      reason: `Solo ${n} intervalo(s) propio(s), sin cohorte ni ventana de exposición adicional - estimación directa de baja confianza.`
    });
  }

  // 3) 1 evento, sin ningún intervalo propio.
  if (observedEventCount === 1) {
    if (cohortEstimateDays) {
      const shrink = runEmpiricalBayesShrinkage({ machineEstimateDays: null, cohortEstimateDays, nIntervals: 0, k, cohortSource });
      return buildResult({
        selectedModel: shrink.model_name,
        modelFamily: "BORROWED_COHORT_ESTIMATE",
        predictionStatus: "BORROWED_COHORT_ESTIMATE",
        estimateDays: shrink.estimate_days,
        extra: { machine_weight: shrink.machine_weight, cohort_weight: shrink.cohort_weight, cohort_source: shrink.cohort_source },
        reason: `Un solo evento observado, sin intervalo propio - se usa 100% la estimación de la cohorte (${cohortSource}).`
      });
    }

    return buildResult({
      selectedModel: "NONE",
      modelFamily: "INSUFFICIENT_DATA",
      predictionStatus: "INSUFFICIENT_DATA",
      estimateDays: null,
      reason: "Un solo evento observado y sin cohorte disponible - sin base estadística suficiente para estimar vida útil."
    });
  }

  // 4) Sin eventos usables.
  return buildResult({
    selectedModel: "NONE",
    modelFamily: "INSUFFICIENT_DATA",
    predictionStatus: "INSUFFICIENT_DATA",
    estimateDays: null,
    reason: "Sin eventos observados para esta combinación."
  });
}
