import type { HomeMetricState, HomeKpiAccent } from "./home.types";
import { formatWholeNumber } from "./home.utils";

// Se compone con HomeMetricState (no status/value independientes) - la
// rama que se renderiza (skeleton/número/mensaje) se decide angostando
// `props.status`, nunca leyendo `value` fuera de la rama "success".
type HomeMetricCardProps = HomeMetricState & {
  label: string;
  accent: HomeKpiAccent;
};

const ACCENT_COLOR: Record<HomeKpiAccent, string> = {
  green: "var(--nx-accent-green)",
  indigo: "var(--nx-accent-indigo)",
  purple: "var(--nx-accent-purple)",
  // Sin token --nx-* exacto para el ámbar del mockup (#b8791c) - se
  // sustituye por --nx-warning-border (misma familia semántica). Ver
  // riesgos documentados en la entrega de esta etapa.
  amber: "var(--nx-warning-border)"
};

export function HomeMetricCard(props: HomeMetricCardProps) {
  return (
    <div
      className="min-w-0 rounded-[var(--nx-radius-card)] border-t-[3px] p-3.5"
      style={{
        borderTopColor: ACCENT_COLOR[props.accent],
        background: "var(--nx-card-bg)",
        boxShadow: "var(--nx-shadow-card)"
      }}
    >
      <div className="break-words text-[13px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        {props.label}
      </div>

      {props.status === "loading" && (
        <div
          aria-hidden="true"
          className="mt-1.5 h-7 w-16 rounded-[var(--nx-radius-chip)]"
          style={{ background: "var(--nx-border)", animation: "nx-pulse 1.6s ease-in-out infinite" }}
        />
      )}

      {props.status === "success" && (
        <div className="tabular-nums mt-1 text-2xl font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
          {formatWholeNumber(props.value)}
        </div>
      )}

      {props.status === "error" && (
        <div className="mt-1 text-sm font-semibold" style={{ color: "var(--nx-danger-fg)" }}>
          No disponible
        </div>
      )}
    </div>
  );
}
