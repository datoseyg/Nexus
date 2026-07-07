import { mean, median, percentile, stddev, coefficientOfVariation } from "../../lib/stats.js";

// Modelo "directo" - vida útil estimada a partir de los intervalos
// observados de la propia combinación, sin tomar prestado de ninguna
// cohorte. Es el modelo recomendado cuando hay suficientes datos propios
// (ver lifecycle-model-selector.js para el umbral). Reusa
// src/lib/stats.js en vez de reimplementar mediana/percentiles.
export function runEmpiricalIntervalModel(intervalDays) {
  const n = intervalDays.length;

  return {
    model_name: n >= 5 ? "TRIMMED_MEAN_INTERVAL" : "MEDIAN_INTERVAL",
    n_intervals: n,
    median_days: median(intervalDays),
    mean_days: mean(intervalDays),
    trimmed_mean_days: n >= 5 ? mean(trimmedSlice(intervalDays)) : null,
    p10_days: percentile(intervalDays, 0.1),
    p25_days: percentile(intervalDays, 0.25),
    p50_days: percentile(intervalDays, 0.5),
    p75_days: percentile(intervalDays, 0.75),
    p90_days: percentile(intervalDays, 0.9),
    stddev_days: stddev(intervalDays),
    coefficient_of_variation: n >= 2 ? coefficientOfVariation(intervalDays) : null
  };
}

// Recorte simétrico del 10% superior/inferior - mismo criterio que
// trimmedMean() de src/lib/stats.js, expuesto acá solo para poder devolver
// también el conjunto recortado (trimmedMean ya hace esto internamente,
// pero no expone el array).
function trimmedSlice(values, trimRatio = 0.1) {
  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimRatio);
  return trimCount > 0 ? sorted.slice(trimCount, sorted.length - trimCount) : sorted;
}
