import type { FieldbeatKpiCardViewModel } from "@/lib/fieldbeat-quality-kpi-view";

interface FieldbeatQualityKpiCardProps {
  view: FieldbeatKpiCardViewModel | null;
  loading?: boolean;
  error?: string | null;
  onDrillDown?: () => void;
}

// Tarjeta compacta de KPI v2 - valor principal + contexto (num/den) +
// interpretación breve + drill-down, con loading/error/denominador-cero
// explícitos (Phase 3 §6). Nunca "Información todavía no disponible".
export function FieldbeatQualityKpiCard({ view, loading, error, onDrillDown }: FieldbeatQualityKpiCardProps) {
  if (error) {
    return (
      <div
        role="group"
        className="rounded-[var(--nx-radius-card)] border p-3.5 min-w-0"
        style={{ borderColor: "var(--nx-danger-fg)", background: "var(--nx-card-bg)" }}
      >
        <p className="text-[13px] font-semibold" style={{ color: "var(--nx-danger-fg)" }}>
          No se pudo calcular este indicador
        </p>
        <p className="mt-1 text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
          {error}
        </p>
      </div>
    );
  }

  if (loading || !view) {
    // Barras dimensionadas para igualar la altura real de la tarjeta cargada
    // (título + valor + contexto + interpretación de 2 líneas + espacio para
    // el drill-down) - un CLS de ~0.12 medido en carga en frío (Phase 3
    // reapertura §7) venía de este esqueleto siendo más bajo que el
    // contenido final.
    return (
      <div
        role="group"
        aria-busy="true"
        className="animate-pulse rounded-[var(--nx-radius-card)] border p-3.5 min-w-0"
        style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}
      >
        <div className="h-3 w-2/3 rounded" style={{ background: "var(--nx-border)" }} />
        <div className="mt-2.5 h-7 w-1/2 rounded" style={{ background: "var(--nx-border)" }} />
        <div className="mt-2.5 h-3 w-full rounded" style={{ background: "var(--nx-border)" }} />
        <div className="mt-2.5 h-3 w-full rounded" style={{ background: "var(--nx-border)" }} />
        <div className="mt-1.5 h-3 w-4/5 rounded" style={{ background: "var(--nx-border)" }} />
        <div className="mt-2.5 h-3 w-1/3 rounded" style={{ background: "var(--nx-border)" }} />
      </div>
    );
  }

  const accentColor = view.tone === "attention" ? "var(--nx-warning-border, var(--nx-accent-purple))" : "var(--nx-border)";

  return (
    <div
      role="group"
      aria-label={view.title}
      className="flex flex-col gap-1.5 rounded-[var(--nx-radius-card)] border p-3.5 min-w-0"
      style={{ borderColor: accentColor, background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <span className="text-[12px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        {view.title}
      </span>
      <span className="text-[26px] font-extrabold leading-none" style={{ color: "var(--nx-text-primary)" }}>
        {view.valueLabel}
      </span>
      <span className="text-[12px]" style={{ color: "var(--nx-text-muted)" }}>
        {view.contextLabel}
      </span>
      <p className="text-[12px] leading-snug" style={{ color: "var(--nx-text-secondary)" }}>
        {view.interpretation}
      </p>
      {onDrillDown && !view.isZeroDenominator && (
        <button
          type="button"
          onClick={onDrillDown}
          className="mt-auto self-start text-[12px] font-semibold underline decoration-dotted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
          style={{ color: "var(--nx-accent-indigo)" }}
        >
          {view.drillDownLabel}
        </button>
      )}
    </div>
  );
}
