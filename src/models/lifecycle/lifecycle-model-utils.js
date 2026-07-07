// Utilidades matemáticas puras compartidas por el motor de modelos de vida
// útil (src/models/lifecycle/*). Sin dependencias externas - ver
// docs/LIFECYCLE_PREDICTIVE_MODELS.md.

// Aproximación de Lanczos (g=7, 9 coeficientes) - implementación estándar
// de la función Gamma sin librería externa. Precisión suficiente para
// nuestro rango de uso (shape entre 0.5 y 5, por lo que 1+1/shape cae
// entre 1.2 y 3 - lejos de los polos en enteros no positivos).
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];

export function gammaFunction(x) {
  if (x < 0.5) {
    return Math.PI / (Math.sin(Math.PI * x) * gammaFunction(1 - x));
  }

  const xShifted = x - 1;
  let a = LANCZOS_COEFFICIENTS[0];
  const t = xShifted + LANCZOS_G + 0.5;

  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += LANCZOS_COEFFICIENTS[i] / (xShifted + i);
  }

  return Math.sqrt(2 * Math.PI) * Math.pow(t, xShifted + 0.5) * Math.exp(-t) * a;
}

// log-sum-exp numéricamente estable - usado para normalizar el posterior
// del grid de Weibull sin overflow/underflow.
export function logSumExp(logValues) {
  if (logValues.length === 0) return -Infinity;

  const max = Math.max(...logValues);
  if (!Number.isFinite(max)) return max;

  const sum = logValues.reduce((acc, v) => acc + Math.exp(v - max), 0);
  return max + Math.log(sum);
}

export function weibullLogPdf(t, shape, scale) {
  if (t <= 0 || shape <= 0 || scale <= 0) return -Infinity;
  const ratio = t / scale;
  return Math.log(shape / scale) + (shape - 1) * Math.log(ratio) - Math.pow(ratio, shape);
}

export function weibullSurvival(t, shape, scale) {
  if (t <= 0) return 1;
  return Math.exp(-Math.pow(t / scale, shape));
}

export function weibullCdf(t, shape, scale) {
  return 1 - weibullSurvival(t, shape, scale);
}

export function weibullMean(shape, scale) {
  return scale * gammaFunction(1 + 1 / shape);
}

export function weibullMedian(shape, scale) {
  return scale * Math.pow(Math.log(2), 1 / shape);
}

// Grid log-espaciado entre min y max (inclusive) con `steps` puntos -
// usado tanto para el grid de shape/scale como para el grid de t (días)
// al extraer percentiles de la mixtura posterior.
export function logSpace(min, max, steps) {
  if (steps <= 1) return [min];
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const points = [];
  for (let i = 0; i < steps; i++) {
    const frac = i / (steps - 1);
    points.push(Math.exp(logMin + frac * (logMax - logMin)));
  }
  return points;
}

export function linSpace(min, max, steps) {
  if (steps <= 1) return [min];
  const points = [];
  for (let i = 0; i < steps; i++) {
    const frac = i / (steps - 1);
    points.push(min + frac * (max - min));
  }
  return points;
}
