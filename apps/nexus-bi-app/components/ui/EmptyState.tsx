interface EmptyStateProps {
  /** @deprecated usar `title` - se mantiene como alias retrocompatible */
  message?: string;
  /** @deprecated usar `description` - se mantiene como alias retrocompatible */
  hint?: string;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}

// Mensaje vacío estándar - nunca una tabla en blanco sin explicación. No lo
// importa ninguna página hoy (confirmado en la auditoría previa), así que
// se amplía su API sin riesgo de romper ningún llamador existente:
// `title`/`description` son el patrón "icono + título + descripción"
// repetido en docs/design-revolution/*.dc.html; `message`/`hint` quedan
// como alias retrocompatibles del contrato anterior.
export function EmptyState({ message, hint, title, description, icon }: EmptyStateProps) {
  const resolvedTitle = title ?? message ?? "";
  const resolvedDescription = description ?? hint;

  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      {icon && (
        <div className="mb-1" style={{ color: "var(--nx-text-muted, var(--text-muted))" }}>
          {icon}
        </div>
      )}
      <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        {resolvedTitle}
      </p>
      {resolvedDescription && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {resolvedDescription}
        </p>
      )}
    </div>
  );
}
