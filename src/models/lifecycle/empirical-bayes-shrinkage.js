// Empirical-Bayes shrinkage - combina la estimación propia de la máquina
// (poca base, n chico) con la de una cohorte más amplia, ponderando por
// cuántos datos propios hay. Fundamental para n < 10 (ver
// docs/LIFECYCLE_PREDICTIVE_MODELS.md). w -> 1 a medida que n_intervals
// crece; w -> 0 si no hay casi datos propios (domina la cohorte).
export function runEmpiricalBayesShrinkage({ machineEstimateDays, cohortEstimateDays, nIntervals, k, cohortSource }) {
  if (cohortEstimateDays === null || cohortEstimateDays === undefined) {
    return null;
  }

  const n = Math.max(0, Number(nIntervals) || 0);
  const w = n / (n + k);

  const machineComponent = machineEstimateDays !== null && machineEstimateDays !== undefined ? machineEstimateDays : cohortEstimateDays;
  const estimateDays = w * machineComponent + (1 - w) * cohortEstimateDays;

  return {
    model_name: "EMPIRICAL_BAYES_SHRINKAGE",
    estimate_days: estimateDays,
    machine_weight: Math.round(w * 1000) / 1000,
    cohort_weight: Math.round((1 - w) * 1000) / 1000,
    cohort_source: cohortSource,
    notes: `Combina ${Math.round(w * 100)}% de historial propio (n=${n}) y ${Math.round((1 - w) * 100)}% de historial de cohorte (${cohortSource}).`
  };
}
