import { logSumExp, weibullLogPdf, weibullSurvival, weibullMean, logSpace, linSpace } from "./lifecycle-model-utils.js";

const T_GRID_STEPS = 200;
const T_GRID_MIN_DAYS = 1;
const T_GRID_MAX_DAYS = 3650;

const PRIOR_SIGMA_BY_STRENGTH = { weak: 2.0, moderate: 1.0, strong: 0.5 };

// Ajusta un Weibull bayesiano por grid (shape x scale) sin dependencias
// pesadas - ver docs/LIFECYCLE_PREDICTIVE_MODELS.md § Bayesian Weibull
// grid. Trabaja en log-likelihood para estabilidad numérica y normaliza
// con log-sum-exp. Si hay un centro de prior (cohorte/fabricante), lo usa
// para regularizar `scale` cuando `n` es chico - si no, prior uniforme.
//
// interval_days: intervalos observados (puede ser [] - el prior solo
// domina el posterior).
// priorScaleCenterDays: mediana de una cohorte/fabricante, o null.
export function runBayesianWeibullGrid(intervalDays, policy, priorScaleCenterDays = null) {
  const cfg = policy.weibull;
  const shapeGrid = linSpace(cfg.shape_grid_min, cfg.shape_grid_max, cfg.shape_grid_steps);
  const scaleGrid = logSpace(cfg.scale_days_min, cfg.scale_days_max, cfg.scale_grid_steps);
  const priorSigma = PRIOR_SIGMA_BY_STRENGTH[cfg.prior_strength] ?? PRIOR_SIGMA_BY_STRENGTH.moderate;

  const logPosteriorFlat = [];
  const gridPoints = [];

  for (let i = 0; i < shapeGrid.length; i++) {
    for (let j = 0; j < scaleGrid.length; j++) {
      const shape = shapeGrid[i];
      const scale = scaleGrid[j];

      let logLikelihood = 0;
      for (const t of intervalDays) {
        logLikelihood += weibullLogPdf(t, shape, scale);
      }

      let logPrior = 0;
      if (priorScaleCenterDays && priorScaleCenterDays > 0) {
        const z = (Math.log(scale) - Math.log(priorScaleCenterDays)) / priorSigma;
        logPrior = -0.5 * z * z;
      }

      const logPosterior = logLikelihood + logPrior;
      logPosteriorFlat.push(logPosterior);
      gridPoints.push({ shapeIndex: i, scaleIndex: j, shape, scale });
    }
  }

  const logZ = logSumExp(logPosteriorFlat);
  const weights = logPosteriorFlat.map(lp => Math.exp(lp - logZ));

  let shapePosteriorMean = 0;
  let scalePosteriorMean = 0;
  let meanLifeDays = 0;
  let maxWeight = -Infinity;
  let argmax = null;

  for (let idx = 0; idx < gridPoints.length; idx++) {
    const w = weights[idx];
    const point = gridPoints[idx];
    shapePosteriorMean += w * point.shape;
    scalePosteriorMean += w * point.scale;
    meanLifeDays += w * weibullMean(point.shape, point.scale);

    if (w > maxWeight) {
      maxWeight = w;
      argmax = point;
    }
  }

  // Supervivencia mixta ponderada por el posterior, en un grid de t
  // log-espaciado - de acá se leen p10/p50/p90 por interpolación (evita
  // integrar la mixtura analíticamente).
  const tGrid = logSpace(T_GRID_MIN_DAYS, T_GRID_MAX_DAYS, T_GRID_STEPS);
  const survivalMix = tGrid.map(t => {
    let s = 0;
    for (let idx = 0; idx < gridPoints.length; idx++) {
      s += weights[idx] * weibullSurvival(t, gridPoints[idx].shape, gridPoints[idx].scale);
    }
    return s;
  });

  function findTimeAtSurvival(targetSurvival) {
    for (let i = 1; i < tGrid.length; i++) {
      if (survivalMix[i] <= targetSurvival) {
        const s0 = survivalMix[i - 1];
        const s1 = survivalMix[i];
        const t0 = tGrid[i - 1];
        const t1 = tGrid[i];
        if (s0 === s1) return t0;
        const frac = (s0 - targetSurvival) / (s0 - s1);
        return t0 + frac * (t1 - t0);
      }
    }
    return tGrid[tGrid.length - 1];
  }

  const p10LifeDays = findTimeAtSurvival(0.9);
  const p50LifeDays = findTimeAtSurvival(0.5);
  const p90LifeDays = findTimeAtSurvival(0.1);

  // Solución en el borde del grid = el grid no contenía el óptimo real,
  // no confiar en este ajuste como "mejor" que shrinkage/mediana empírica
  // (ver lifecycle-model-selector.js).
  const isBoundarySolution = argmax
    ? argmax.shapeIndex === 0 || argmax.shapeIndex === shapeGrid.length - 1
      || argmax.scaleIndex === 0 || argmax.scaleIndex === scaleGrid.length - 1
    : true;

  let posteriorQualityStatus;
  if (intervalDays.length < (policy.minimum_intervals_for_weibull ?? 3)) {
    posteriorQualityStatus = "PRIOR_DOMINATED";
  } else if (isBoundarySolution || !Number.isFinite(logZ)) {
    posteriorQualityStatus = "UNSTABLE_POSTERIOR";
  } else {
    posteriorQualityStatus = "STABLE";
  }

  return {
    model_name: "BAYESIAN_WEIBULL_GRID",
    shape_posterior_mean: Math.round(shapePosteriorMean * 1000) / 1000,
    scale_posterior_mean: Math.round(scalePosteriorMean * 100) / 100,
    median_life_days: Math.round(p50LifeDays * 100) / 100,
    mean_life_days: Math.round(meanLifeDays * 100) / 100,
    p10_life_days: Math.round(p10LifeDays * 100) / 100,
    p50_life_days: Math.round(p50LifeDays * 100) / 100,
    p90_life_days: Math.round(p90LifeDays * 100) / 100,
    credible_interval_low_days: Math.round(p10LifeDays * 100) / 100,
    credible_interval_high_days: Math.round(p90LifeDays * 100) / 100,
    posterior_quality_status: posteriorQualityStatus,
    notes: `Grid ${shapeGrid.length}x${scaleGrid.length} (shape x scale), ${intervalDays.length} intervalo(s) usados` +
      (priorScaleCenterDays ? `, prior centrado en ${Math.round(priorScaleCenterDays)} días (${cfg.prior_strength})` : ", sin prior externo (uniforme)") + "."
  };
}
