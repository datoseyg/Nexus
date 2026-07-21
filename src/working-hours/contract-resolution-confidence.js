// Confianza contractual ADITIVA (contract_resolution_confidence/_label),
// NUNCA reemplaza confidence_score (interval-resolver.js, fórmula histórica
// intacta) -mide una dimensión distinta: qué tan confiable es la
// RESOLUCIÓN CONTRACTUAL (match + schedule + multi-equipo), no la calidad
// del intervalo. Solo se calcula cuando data_basis=CONTRACTUAL (el CHECK de
// sql/081 lo exige NULL en cualquier otro caso) -nunca convierte un caso no
// calculable en calculable: se computa DESPUÉS de que la cascada ya decidió
// CONTRACTUAL, es descriptivo, no decisorio.
//
// confidence_model_version='contract-v1' -primera versión, simulada contra
// datos reales antes de usarse (ver docs de este builder / reporte de
// 6.6B2), nunca aplicada sin simulación previa (mismo criterio que evitó el
// reescalado de 7 factores rechazado en 6.6A.1).

export const CONFIDENCE_MODEL_VERSION = "contract-v1";

const MATCH_METHOD_POINTS = Object.freeze({ SERIAL_SUFFIX: 40, OVERRIDE: 40, CLIENT_SITE_MODEL: 20 });
const COVERAGE_TYPE_POINTS = Object.freeze({ FULL_24X7: 30, FIXED_WINDOW: 30, BUSINESS_HOURS_UNDEFINED: 10, ON_DEMAND: 10, NOT_COVERED: 10, NOT_APPLICABLE: 10, UNKNOWN: 0 });

function tierLabel(score) {
  if (score >= 85) return "Alta";
  if (score >= 65) return "Media";
  if (score >= 40) return "Baja";
  return "Insuficiente";
}

/**
 * @param {{ matchMethod: string, coverageType: string, multiEquipmentOutcome: 'SINGLE_EQUIPMENT'|'MULTIPLE_EQUIPMENT_SAME_COVERAGE' }} input
 * @returns {{ score: number, label: string, factors: string, modelVersion: string }}
 */
export function calculateContractResolutionConfidence({ matchMethod, coverageType, multiEquipmentOutcome }) {
  const factorDetails = [];
  let score = 0;

  const matchPoints = MATCH_METHOD_POINTS[matchMethod] ?? 0;
  score += matchPoints;
  factorDetails.push({ reason: `método de match: ${matchMethod}`, points: matchPoints });

  const coveragePoints = COVERAGE_TYPE_POINTS[coverageType] ?? 0;
  score += coveragePoints;
  factorDetails.push({ reason: `especificidad del horario: ${coverageType}`, points: coveragePoints });

  const multiPoints = multiEquipmentOutcome === "MULTIPLE_EQUIPMENT_SAME_COVERAGE" ? 30 : 20;
  score += multiPoints;
  factorDetails.push({ reason: multiEquipmentOutcome === "MULTIPLE_EQUIPMENT_SAME_COVERAGE" ? "múltiples equipos coinciden en cobertura (refuerzo cruzado)" : "un único equipo (sin refuerzo cruzado)", points: multiPoints });

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clampedScore, label: tierLabel(clampedScore), factors: factorDetails.map(f => `${f.reason} (+${f.points})`).join(" | "), modelVersion: CONFIDENCE_MODEL_VERSION };
}
