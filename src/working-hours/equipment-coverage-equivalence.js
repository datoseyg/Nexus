// Equivalencia multi-equipo vía coverage_fingerprint: dos equipos son
// "misma cobertura" si y solo si producen el MISMO conjunto normalizado de
// intervalos [start_utc,end_utc) cubiertos para la tarea -nunca por
// comparar categorías (coverage_classification), que pierde información
// real (dos equipos con la misma categoría pueden tener minutos cubiertos
// distintos). Se retira la regla de "tomar el equipo más conservador":
// cuando los fingerprints coinciden, el conjunto compartido ES la respuesta,
// sin ambigüedad que resolver.

import crypto from "node:crypto";

/**
 * Fusiona intervalos [start,end) posiblemente solapados/adyacentes en la
 * unión canónica mínima, ordenada por inicio.
 * @param {{ startUtc: Date, endUtc: Date }[]} intervals
 * @returns {{ startUtc: Date, endUtc: Date }[]}
 */
export function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.startUtc.getTime() <= last.endUtc.getTime()) {
      if (current.endUtc.getTime() > last.endUtc.getTime()) {
        merged[merged.length - 1] = { startUtc: last.startUtc, endUtc: current.endUtc };
      }
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * Serialización canónica: array JSON de pares ISO8601 UTC en milisegundos,
 * ordenado, sin ambigüedad de formato. Un equipo sin ningún intervalo
 * cubierto produce "[]" -hash constante y reproducible.
 * @param {{ startUtc: Date, endUtc: Date }[]} mergedIntervals ya fusionados y ordenados
 * @returns {string}
 */
export function canonicalizeIntervals(mergedIntervals) {
  return JSON.stringify(mergedIntervals.map(({ startUtc, endUtc }) => [startUtc.toISOString(), endUtc.toISOString()]));
}

/**
 * @param {{ startUtc: Date, endUtc: Date }[]} coveredIntervals intervalos COVERED de un equipo para una tarea (sin fusionar todavía)
 * @returns {string} hex sha256 del conjunto canónico
 */
export function computeCoverageFingerprint(coveredIntervals) {
  const canonical = canonicalizeIntervals(mergeIntervals(coveredIntervals));
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const EMPTY_COVERAGE_FINGERPRINT = computeCoverageFingerprint([]);

/**
 * @param {{ fieldbeatEquipmentKey: string, coverageFingerprint: string|null, calculable: boolean }[]} equipmentResults
 *   uno por equipo vinculado a la tarea, ya evaluado bajo schedule_source=CONTRACT
 * @returns {{
 *   outcome: 'NO_EQUIPMENT' | 'SINGLE_EQUIPMENT' | 'MULTIPLE_EQUIPMENT_SAME_COVERAGE' | 'MULTIPLE_EQUIPMENT_CONFLICT',
 *   primaryEquipmentKey: string|null
 * }}
 */
export function evaluateMultiEquipmentEquivalence(equipmentResults) {
  if (equipmentResults.length === 0) {
    return { outcome: "NO_EQUIPMENT", primaryEquipmentKey: null };
  }

  if (equipmentResults.length === 1) {
    const [only] = equipmentResults;
    return { outcome: "SINGLE_EQUIPMENT", primaryEquipmentKey: only.calculable ? only.fieldbeatEquipmentKey : null };
  }

  // Conflicto si CUALQUIER equipo no es calculable (fingerprint no
  // comparable) o si los fingerprints de los calculables difieren.
  if (equipmentResults.some(e => !e.calculable)) {
    return { outcome: "MULTIPLE_EQUIPMENT_CONFLICT", primaryEquipmentKey: null };
  }

  const distinctFingerprints = new Set(equipmentResults.map(e => e.coverageFingerprint));
  if (distinctFingerprints.size > 1) {
    return { outcome: "MULTIPLE_EQUIPMENT_CONFLICT", primaryEquipmentKey: null };
  }

  // Misma cobertura -cualquiera de los equivalentes sirve; desempate
  // determinístico por menor fieldbeat_equipment_key (los minutos son
  // idénticos por construcción, no afecta el resultado numérico).
  const sortedKeys = [...equipmentResults].sort((a, b) => a.fieldbeatEquipmentKey.localeCompare(b.fieldbeatEquipmentKey));
  return { outcome: "MULTIPLE_EQUIPMENT_SAME_COVERAGE", primaryEquipmentKey: sortedKeys[0].fieldbeatEquipmentKey };
}
