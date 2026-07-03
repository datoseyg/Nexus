interface EmptyStateProps {
  message: string;
  hint?: string;
}

// Mensaje vacío estándar — nunca una tabla en blanco sin explicación. Ver
// docs/VISUAL_REDESIGN_EYG.md.
export function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        {message}
      </p>
      {hint && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
