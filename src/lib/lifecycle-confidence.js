// Modelo de confiabilidad para "Vida Útil de Repuestos por Máquina" (ver
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md). Reusa los mismos tiers
// 85-100/65-84/40-64/0-39 (Alta/Media/Baja/Insuficiente) que
// calculation-confidence.js - no se redefinen acá para no tener dos fuentes
// de verdad de los umbrales.
//
// IMPORTANTE: igual que el modelo de Trabajo Fuera de Horario, esto NO es
// una probabilidad estadística. Es un score de confiabilidad METODOLÓGICA
// (0-100) basado en cantidad/calidad/trazabilidad de los datos usados para
// estimar una vida útil - nunca presentar como garantía de certeza.

import { getConfidenceLabel, getConfidenceColor } from "./calculation-confidence.js";

const STRONG_MATCH_METHODS = new Set([
  "REF_EXACT",
  "BARCODE_EXACT",
  "ID_EXACT",
  "REF_NORMALIZED_EXACT",
  "BARCODE_NORMALIZED_EXACT",
  "MANUAL_ALIAS_EXACT"
]);

function clampScore(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

// context = {
//   observedEventCount, validIntervalCount,
//   dominantMatchStatus: "MATCHED" | "AMBIGUOUS_MATCH" | "NO_MATCH" | "PLACEHOLDER_VALUE",
//   dominantMatchMethod: string (uno de los match_method vistos, el más frecuente),
//   equipmentClarity: "SINGLE" | "MULTI" | "NONE" (¿las tasks de origen tenían 1 equipo, varios, o no había equipo?),
//   coverageMonths: number | null (meses entre primer y último evento observado),
//   datesComplete: boolean (todas las fechas usadas son válidas),
//   coefficientOfVariation: number | null (stddev/mean de los intervalos válidos),
//   hasUsageHours: boolean (existen horas de operación/after-hours para las tasks de origen),
//   hasPartialUsageData: boolean (existe duración parcial pero no horas completas),
//   estimatedLifeMethod: string (uno de los valores de estimated_life_method)
// }
export function calculateLifecycleConfidence(context = {}) {
  const factorDetails = [];
  let score = 0;

  // Factor 1 (+25/+18/+10/+3/+0): cantidad de eventos/intervalos.
  const eventCount = Number(context.observedEventCount) || 0;
  const intervalCount = Number(context.validIntervalCount) || 0;

  if (eventCount >= 5 && intervalCount >= 4) {
    score += 25;
    factorDetails.push({ factor: "cantidad_datos", points: 25, max: 25, reason: `${eventCount} eventos, ${intervalCount} intervalos válidos` });
  } else if (eventCount >= 3) {
    score += 18;
    factorDetails.push({ factor: "cantidad_datos", points: 18, max: 25, reason: `${eventCount} eventos observados (3-4)` });
  } else if (eventCount === 2) {
    score += 10;
    factorDetails.push({ factor: "cantidad_datos", points: 10, max: 25, reason: "2 eventos observados" });
  } else if (eventCount === 1) {
    score += 3;
    factorDetails.push({ factor: "cantidad_datos", points: 3, max: 25, reason: "solo 1 evento observado" });
  } else {
    factorDetails.push({ factor: "cantidad_datos", points: 0, max: 25, reason: "sin eventos observados" });
  }

  // Factor 2 (+15/+10/+4/+0): calidad de match Dolibarr.
  const matchStatus = context.dominantMatchStatus || "NO_MATCH";
  const matchMethod = context.dominantMatchMethod || "";

  if (matchStatus === "MATCHED" && STRONG_MATCH_METHODS.has(matchMethod)) {
    score += 15;
    factorDetails.push({ factor: "calidad_match", points: 15, max: 15, reason: `match exacto/alias (${matchMethod})` });
  } else if (matchStatus === "MATCHED") {
    score += 10;
    factorDetails.push({ factor: "calidad_match", points: 10, max: 15, reason: `match por método débil (${matchMethod || "desconocido"})` });
  } else if (matchStatus === "AMBIGUOUS_MATCH") {
    score += 4;
    factorDetails.push({ factor: "calidad_match", points: 4, max: 15, reason: "match ambiguo (múltiples candidatos Dolibarr)" });
  } else {
    factorDetails.push({ factor: "calidad_match", points: 0, max: 15, reason: `sin match confiable (${matchStatus})` });
  }

  // Factor 3 (+15/+7/+0): claridad de la asociación máquina-repuesto.
  const equipmentClarity = context.equipmentClarity || "NONE";
  if (equipmentClarity === "SINGLE") {
    score += 15;
    factorDetails.push({ factor: "claridad_asociacion", points: 15, max: 15, reason: "eventos provienen de tasks con 1 solo equipo asociado" });
  } else if (equipmentClarity === "MULTI") {
    score += 7;
    factorDetails.push({ factor: "claridad_asociacion", points: 7, max: 15, reason: "eventos provienen de tasks con múltiples equipos asociados" });
  } else {
    factorDetails.push({ factor: "claridad_asociacion", points: 0, max: 15, reason: "sin equipo claramente asociado" });
  }

  // Factor 4 (+15/+10/+5/+0): fechas válidas y cobertura temporal.
  const coverageMonths = context.coverageMonths;
  const datesComplete = context.datesComplete !== false;

  if (!datesComplete || coverageMonths === null || coverageMonths === undefined) {
    factorDetails.push({ factor: "cobertura_temporal", points: 0, max: 15, reason: "fechas incompletas o sin cobertura calculable" });
  } else if (coverageMonths > 24) {
    score += 15;
    factorDetails.push({ factor: "cobertura_temporal", points: 15, max: 15, reason: `cobertura de ${Math.round(coverageMonths)} meses (>24)` });
  } else if (coverageMonths >= 12) {
    score += 10;
    factorDetails.push({ factor: "cobertura_temporal", points: 10, max: 15, reason: `cobertura de ${Math.round(coverageMonths)} meses (12-24)` });
  } else {
    score += 5;
    factorDetails.push({ factor: "cobertura_temporal", points: 5, max: 15, reason: `cobertura de ${Math.round(coverageMonths)} meses (<12)` });
  }

  // Factor 5 (+10/+6/+2/+0): consistencia estadística (coeficiente de variación).
  const cv = context.coefficientOfVariation;
  if (cv === null || cv === undefined) {
    factorDetails.push({ factor: "consistencia_estadistica", points: 0, max: 10, reason: "sin intervalos suficientes para medir consistencia" });
  } else if (cv <= 0.3) {
    score += 10;
    factorDetails.push({ factor: "consistencia_estadistica", points: 10, max: 10, reason: `coeficiente de variación bajo (${cv.toFixed(2)})` });
  } else if (cv <= 0.7) {
    score += 6;
    factorDetails.push({ factor: "consistencia_estadistica", points: 6, max: 10, reason: `coeficiente de variación medio (${cv.toFixed(2)})` });
  } else {
    score += 2;
    factorDetails.push({ factor: "consistencia_estadistica", points: 2, max: 10, reason: `coeficiente de variación alto (${cv.toFixed(2)})` });
  }

  // Factor 6 (+10/+5/+0): datos de uso/operación disponibles.
  if (context.hasUsageHours) {
    score += 10;
    factorDetails.push({ factor: "datos_de_uso", points: 10, max: 10, reason: "horas de operación/after-hours disponibles para las tasks de origen" });
  } else if (context.hasPartialUsageData) {
    score += 5;
    factorDetails.push({ factor: "datos_de_uso", points: 5, max: 10, reason: "duración parcial disponible, sin clasificación completa de horas" });
  } else {
    factorDetails.push({ factor: "datos_de_uso", points: 0, max: 10, reason: "sin datos de horas de operación" });
  }

  // Factor 7 (+10/+8/+4/+0): método de estimación usado.
  const method = context.estimatedLifeMethod || "INSUFFICIENT_DATA";
  if (method === "MEDIAN_INTERVAL" && intervalCount >= 3) {
    score += 10;
    factorDetails.push({ factor: "metodo_estimacion", points: 10, max: 10, reason: `mediana sobre ${intervalCount} intervalos` });
  } else if (method === "TRIMMED_MEAN_INTERVAL") {
    score += 8;
    factorDetails.push({ factor: "metodo_estimacion", points: 8, max: 10, reason: "media recortada sobre datos suficientes" });
  } else if (method === "PART_FAMILY_BORROWED_ESTIMATE" || method === "CLIENT_LEVEL_ESTIMATE") {
    score += 4;
    factorDetails.push({ factor: "metodo_estimacion", points: 4, max: 10, reason: "estimación prestada de otro nivel de agregación (borrowed estimate)" });
  } else {
    factorDetails.push({ factor: "metodo_estimacion", points: 0, max: 10, reason: `datos insuficientes para un método robusto (${method})` });
  }

  const clampedScore = clampScore(score);
  const { label } = getConfidenceLabel(clampedScore);

  return {
    score: clampedScore,
    label,
    color: getConfidenceColor(clampedScore),
    factors: factorDetails.map(f => `${f.reason} (+${f.points})`).join(" | "),
    factorDetails
  };
}
