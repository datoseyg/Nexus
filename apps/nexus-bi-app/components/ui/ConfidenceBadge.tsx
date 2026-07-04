import { StatusBadge } from "./StatusBadge";
import { getConfidenceColor } from "@/lib/confidence";

interface ConfidenceBadgeProps {
  score: number;
  label: string;
  factors?: string | null;
  size?: "sm" | "md";
  showTooltip?: boolean;
}

// Insignia de confiabilidad METODOLÓGICA (no es una probabilidad
// estadística - ver docs/CALCULATION_CONFIDENCE_MODEL.md). Formato
// "Confiabilidad NN% · Etiqueta", ej. "Confiabilidad 88% · Alta". Tooltip
// vía title= (no hay librería de popover en este repo, mismo mecanismo
// que el resto de la app, ej. PartsReviewSection.tsx).
export function ConfidenceBadge({ score, label, factors, size = "md", showTooltip = true }: ConfidenceBadgeProps) {
  const tone = getConfidenceColor(score);
  const rounded = Math.round(score);
  const text = `Confiabilidad ${rounded}% · ${label}`;
  const tooltip =
    showTooltip && factors
      ? factors
          .split("|")
          .map(factor => factor.trim())
          .filter(Boolean)
          .join("\n")
      : undefined;

  return (
    <span title={tooltip}>
      <StatusBadge label={text} tone={tone} size={size} />
    </span>
  );
}
