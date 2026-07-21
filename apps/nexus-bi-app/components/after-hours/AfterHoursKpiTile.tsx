interface AfterHoursKpiTileProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accentColor?: string;
  tone?: "light" | "dark";
}

// Tarjeta KPI de /dashboard/after-hours - mismo patrón visual que
// components/dashboard/KpiCard.tsx (label + valor grande + accento
// superior opcional), reconstruido acá porque KpiCard vive fuera del
// scope permitido de ETAPA 6.6D (components/dashboard/**). Agrega la
// variante oscura ("Nivel general de confianza", fondo --nx-sidebar-bg)
// del prototipo, que KpiCard no tiene.
export function AfterHoursKpiTile({ label, value, hint, accentColor, tone = "light" }: AfterHoursKpiTileProps) {
  const dark = tone === "dark";
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-[var(--nx-radius-card)] p-4"
      style={{
        background: dark ? "var(--nx-sidebar-bg)" : "var(--nx-card-bg)",
        boxShadow: dark ? "var(--nx-shadow-card-dark)" : "var(--nx-shadow-card)",
        borderTop: !dark && accentColor ? `3px solid ${accentColor}` : undefined
      }}
    >
      <span className="text-[13px]" style={{ color: dark ? "var(--nx-sidebar-text-muted)" : "var(--nx-text-secondary)" }}>
        {label}
      </span>
      <span
        className="break-words text-[27px] font-extrabold [font-variant-numeric:tabular-nums]"
        style={{ color: dark ? "var(--nx-sidebar-text-primary)" : "var(--nx-text-primary)" }}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[13px]" style={{ color: dark ? "var(--nx-sidebar-text-muted)" : "var(--nx-text-muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}
