import { formatCompactNumber } from "@/lib/format";

interface MetricCardProps {
  label: string;
  value: number | string | null | undefined;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const TONE_COLOR: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "var(--nx-text-primary)",
  success: "var(--nx-accent-green)",
  warning: "var(--nx-warning-fg, #7a4f0a)",
  danger: "var(--nx-danger-fg, #c0392b)"
};

// Stat tile de la identidad E&G: label + valor grande + hint opcional.
// Reemplaza components/KpiCard.tsx (ver docs/VISUAL_REDESIGN_EYG.md) -
// mismo rol, nombre alineado al resto de components/ui/.
export function MetricCard({ label, value, hint, tone = "default" }: MetricCardProps) {
  const display = typeof value === "number" ? formatCompactNumber(value) : value ?? "-";

  return (
    <div
      className="rounded-xl border p-4 min-w-0"
      style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <div className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </div>
      <div className="mt-1 truncate text-3xl font-semibold" style={{ color: TONE_COLOR[tone] }}>
        {display}
      </div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
