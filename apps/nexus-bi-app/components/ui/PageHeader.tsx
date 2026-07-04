interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: string;
}

// Encabezado estándar de pantalla: eyebrow (contexto corto, opcional) +
// título + descripción + acciones a la derecha. Reemplaza los bloques
// <h1>/<p> ad-hoc que cada pantalla armaba por separado - ver
// docs/VISUAL_REDESIGN_EYG.md.
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--eyg-green-dark)" }}>
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--text-secondary)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
