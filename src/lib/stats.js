// Utilidades estadísticas puras, sin dependencias externas (ver
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md). No hay precedente de
// mediana/percentiles/stddev en src/gold/* antes de esto - se centraliza
// acá porque lo consumen 3 tablas GOLD de vida útil (By_Machine/By_Client/
// By_Part), no es una abstracción para un solo uso.

function toSortedNumbers(values) {
  return values
    .map(v => Number(v))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
}

export function mean(values) {
  const nums = toSortedNumbers(values);
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

// Percentil por interpolación lineal (método usado por DuckDB PERCENTILE_CONT
// y numpy default) - p entre 0 y 1.
export function percentile(values, p) {
  const nums = toSortedNumbers(values);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];

  const rank = p * (nums.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return nums[lower];

  const weight = rank - lower;
  return nums[lower] * (1 - weight) + nums[upper] * weight;
}

export function median(values) {
  return percentile(values, 0.5);
}

export function stddev(values) {
  const nums = toSortedNumbers(values);
  if (nums.length < 2) return null;

  const avg = mean(nums);
  const variance = nums.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

// Media recortada (descarta el 10% más bajo y más alto por defecto) - menos
// sensible a outliers que el promedio simple, pero usa más datos que la
// mediana. Requiere al menos 5 valores para que el recorte tenga sentido;
// si no, cae a la mediana.
export function trimmedMean(values, trimRatio = 0.1) {
  const nums = toSortedNumbers(values);
  if (nums.length === 0) return null;
  if (nums.length < 5) return median(nums);

  const trimCount = Math.floor(nums.length * trimRatio);
  const trimmed = trimCount > 0 ? nums.slice(trimCount, nums.length - trimCount) : nums;
  return mean(trimmed);
}

// Límites de outlier por rango intercuartil (regla 1.5×IQR, estándar de
// boxplot). Devuelve null si no hay suficientes datos para un IQR
// confiable (se exige >=4 valores).
export function iqrBounds(values) {
  const nums = toSortedNumbers(values);
  if (nums.length < 4) return null;

  const q1 = percentile(nums, 0.25);
  const q3 = percentile(nums, 0.75);
  const iqr = q3 - q1;

  return {
    q1,
    q3,
    iqr,
    lower: q1 - 1.5 * iqr,
    upper: q3 + 1.5 * iqr
  };
}

export function coefficientOfVariation(values) {
  const avg = mean(values);
  const sd = stddev(values);
  if (avg === null || sd === null || avg === 0) return null;
  return sd / avg;
}
