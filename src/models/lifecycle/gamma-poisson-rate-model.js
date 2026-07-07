const DAYS_PER_YEAR = 365.25;

// Gamma-Poisson conjugado - cerrado analíticamente, sin integración
// numérica. Útil cuando no hay suficientes intervalos pero sí hay conteo
// de eventos + ventana temporal observada (exposición). Ver
// docs/LIFECYCLE_PREDICTIVE_MODELS.md.
//
// replacement_count ~ Poisson(lambda * exposure_years)
// lambda ~ Gamma(alpha, beta)               (prior, tasas/año)
// lambda | data ~ Gamma(alpha + count, beta + exposure_years)   (posterior)
export function runGammaPoissonRateModel({ replacementCount, exposureYears, priorAlpha, priorBeta }) {
  if (!(exposureYears > 0)) return null;

  const alphaPost = priorAlpha + replacementCount;
  const betaPost = priorBeta + exposureYears;

  const lambdaMean = alphaPost / betaPost;
  if (!(lambdaMean > 0)) return null;

  // Aproximación normal al posterior Gamma (media=alpha/beta,
  // var=alpha/beta^2) para un intervalo creíble ~80% - no es la cuantila
  // exacta de la Gamma, pero evita implementar la función gamma incompleta
  // inversa. Documentado como aproximación, no un intervalo exacto.
  const lambdaSd = Math.sqrt(alphaPost) / betaPost;
  const lambdaLow = Math.max(1e-6, lambdaMean - 1.28 * lambdaSd);
  const lambdaHigh = lambdaMean + 1.28 * lambdaSd;

  const expectedLifeDays = DAYS_PER_YEAR / lambdaMean;

  return {
    model_name: "GAMMA_POISSON_RATE_MODEL",
    replacement_rate_per_year: Math.round(lambdaMean * 1000) / 1000,
    expected_life_days: Math.round(expectedLifeDays * 100) / 100,
    credible_interval_low_days: Math.round((DAYS_PER_YEAR / lambdaHigh) * 100) / 100,
    credible_interval_high_days: Math.round((DAYS_PER_YEAR / lambdaLow) * 100) / 100,
    replacement_count: replacementCount,
    exposure_years: Math.round(exposureYears * 1000) / 1000,
    notes: `Basado en ${replacementCount} evento(s) sobre ${Math.round(exposureYears * 12)} meses de exposición observada - intervalo creíble aproximado (normal sobre el posterior Gamma).`
  };
}
