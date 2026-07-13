interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  accentColor?: string;
  compact?: boolean;
}

// Tarjeta KPI del Dashboard Operacional, migrada a tokens --nx-* (ver
// docs/design-revolution/Claude-Designs/Nexus - Dashboard Operacional -
// standalone.html). `accentColor` reproduce el borde superior de color de
// las 3 métricas principales del standalone; las tarjetas secundarias
// (sin accento real en el mockup) se dejan sin ese borde en vez de
// inventarle uno. `compact` reduce el tamaño de valor para texto largo
// (ej. nombre de cliente) en vez de truncarlo.
export function KpiCard({ label, value, hint, accentColor, compact = false }: KpiCardProps) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-[var(--nx-radius-card)] p-4"
      style={{
        background: "var(--nx-card-bg)",
        boxShadow: "var(--nx-shadow-card)",
        borderTop: accentColor ? `3px solid ${accentColor}` : undefined
      }}
    >
      <span className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </span>
      <span
        className={`break-words font-extrabold ${compact ? "text-sm leading-snug" : "text-[27px] [font-variant-numeric:tabular-nums]"}`}
        style={{ color: "var(--nx-text-primary)" }}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}
