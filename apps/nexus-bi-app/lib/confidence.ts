import type { StatusTone } from "@/components/ui/StatusBadge";

// Mirror liviano de src/lib/calculation-confidence.js (solo
// getConfidenceLabel/getConfidenceColor) - el frontend NUNCA recalcula el
// score de confiabilidad, solo lee columnas ya precomputadas por el
// pipeline (confidence_score/confidence_label ya vienen del warehouse).
// Fuente de verdad de los tiers: docs/CALCULATION_CONFIDENCE_MODEL.md -
// mantener sincronizado a mano con src/lib/calculation-confidence.js si
// cambian los umbrales.
interface ConfidenceTier {
  min: number;
  max: number;
  label: string;
  tone: StatusTone;
  description: string;
}

const CONFIDENCE_TIERS: ConfidenceTier[] = [
  { min: 0, max: 39, label: "Insuficiente", tone: "danger", description: "El dato base no permite confiar en el cálculo." },
  { min: 40, max: 64, label: "Baja", tone: "warning", description: "El cálculo usa datos incompletos o supuestos fuertes." },
  { min: 65, max: 84, label: "Media", tone: "info", description: "El cálculo es razonable, pero depende de supuestos o campos derivados." },
  { min: 85, max: 100, label: "Alta", tone: "success", description: "El cálculo usa datos completos, consistentes y reglas validadas." }
];

function findTier(score: number): ConfidenceTier {
  const clamped = Math.max(0, Math.min(100, Math.round(score || 0)));
  return CONFIDENCE_TIERS.find(t => clamped >= t.min && clamped <= t.max) ?? CONFIDENCE_TIERS[0];
}

export function getConfidenceLabel(score: number): { label: string; description: string } {
  const tier = findTier(score);
  return { label: tier.label, description: tier.description };
}

export function getConfidenceColor(score: number): StatusTone {
  return findTier(score).tone;
}
