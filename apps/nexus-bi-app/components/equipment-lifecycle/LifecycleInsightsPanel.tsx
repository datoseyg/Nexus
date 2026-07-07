import type { StatusTone } from "@/components/ui/StatusBadge";
import type { LifecycleInsightRow } from "@/types/equipment-lifecycle";

interface LifecycleInsightsPanelProps {
  insights: LifecycleInsightRow[];
  loading: boolean;
}

const SEVERITY_TONE: Record<string, StatusTone> = {
  positive: "success",
  warning: "warning",
  info: "info"
};

const SEVERITY_COLOR: Record<StatusTone, { bg: string; fg: string }> = {
  success: { bg: "#eaf5ea", fg: "#2f5c2a" },
  warning: { bg: "#fdf1da", fg: "#8a5a06" },
  info: { bg: "#e6f3f3", fg: "#175f5f" },
  danger: { bg: "#fbeae9", fg: "#a03330" },
  neutral: { bg: "#eef1f0", fg: "#5e6b70" }
};

// Panel de insights (Parte 8.7) - frases generadas por reglas fijas en
// src/gold/build-equipment-part-lifecycle-gold.js (buildInsights), nunca
// por un modelo de IA. Ninguna frase afirma causalidad.
export function LifecycleInsightsPanel({ insights, loading }: LifecycleInsightsPanelProps) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Insights (generados por reglas, no por IA)
      </h3>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Cargando insights...</p>
      ) : insights.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Sin insights para esta selección todavía.</p>
      ) : (
        <ul className="space-y-2">
          {insights.map((insight, index) => {
            const tone = SEVERITY_TONE[insight.severity] ?? "neutral";
            const color = SEVERITY_COLOR[tone];
            return (
              <li
                key={`${insight.equipment_internal_id}-${insight.dolibarr_ref}-${index}`}
                className="rounded-lg p-3 text-sm"
                style={{ background: color.bg, color: color.fg }}
              >
                {insight.insight_text}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
