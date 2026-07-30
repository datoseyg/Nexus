interface SectionCardProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}

// Card blanca genérica (borde suave + sombra mínima) - la unidad visual
// base del sistema E&G, usada para envolver cualquier bloque de
// contenido que no sea ya una tabla (ver ResponsiveTableShell) o un
// MetricCard. Ver docs/VISUAL_REDESIGN_EYG.md.
export function SectionCard({ title, description, actions, children, padded = true }: SectionCardProps) {
  return (
    <section
      className="rounded-xl border min-w-0"
      style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      {(title || actions) && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--nx-border)" }}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}
