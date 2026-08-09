import { formatCompactNumber } from "@/lib/format";
import { ConfidenceBadge } from "./ConfidenceBadge";

interface MetricCardWithConfidenceProps {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  hint?: string;
  confidence: { score: number; label: string; factors?: string | null };
  isEstimated?: boolean;
}

// Extiende MetricCard.tsx agregando la capa de confiabilidad de Trabajo
// Fuera de Horario - ver docs/CALCULATION_CONFIDENCE_MODEL.md § cómo
// mostrarse en UI. Nunca comunica certeza absoluta: si confidence.score<40
// muestra "Usar con cautela"; si no, si <65 muestra "Cálculo preliminar".
export function MetricCardWithConfidence({ label, value, unit, hint, confidence, isEstimated }: MetricCardWithConfidenceProps) {
  const display = typeof value === "number" ? formatCompactNumber(value) : (value ?? "-");
  const caution = confidence.score < 40 ? "Usar con cautela" : confidence.score < 65 ? "Cálculo preliminar" : null;

  return (
    <div
      className="rounded-xl border p-4 min-w-0"
      style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <div className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </div>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="truncate text-3xl font-semibold" style={{ color: "var(--nx-text-primary)" }}>
          {display}
        </span>
        {unit && (
          <span className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
            {unit}
          </span>
        )}
      </div>

      <div className="mt-2">
        <ConfidenceBadge score={confidence.score} label={confidence.label} factors={confidence.factors} size="sm" />
      </div>

      {hint && (
        <div className="mt-1 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          {hint}
        </div>
      )}

      {isEstimated && !caution && (
        <div className="mt-1 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          Valor estimado
        </div>
      )}

      {caution && (
        <div
          className="mt-1 text-xs font-medium"
          style={{ color: caution === "Usar con cautela" ? "var(--nx-danger-fg, #c0392b)" : "var(--nx-warning-fg, #7a4f0a)" }}
        >
          {caution}
        </div>
      )}
    </div>
  );
}
