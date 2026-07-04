import { formatCompactNumber } from "@/lib/format";

interface MetricCardProps {
  label: string;
  value: number | string | null | undefined;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const TONE_COLOR: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "var(--text-primary)",
  success: "var(--eyg-green-dark)",
  warning: "var(--eyg-warning)",
  danger: "var(--eyg-danger)"
};

// Stat tile de la identidad E&G: label + valor grande + hint opcional.
// Reemplaza components/KpiCard.tsx (ver docs/VISUAL_REDESIGN_EYG.md) -
// mismo rol, nombre alineado al resto de components/ui/.
export function MetricCard({ label, value, hint, tone = "default" }: MetricCardProps) {
  const display = typeof value === "number" ? formatCompactNumber(value) : value ?? "-";

  return (
    <div
      className="rounded-xl border p-4 min-w-0"
      style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", boxShadow: "0 1px 3px rgba(36,48,51,0.07)" }}
    >
      <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div className="mt-1 truncate text-3xl font-semibold" style={{ color: TONE_COLOR[tone] }}>
        {display}
      </div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
