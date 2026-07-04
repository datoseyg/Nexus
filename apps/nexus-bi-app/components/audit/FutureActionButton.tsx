interface FutureActionButtonProps {
  label: string;
}

// Botón de acción de curación NO implementada todavía en este corte -
// visible y claramente marcado como futuro, nunca oculto en silencio. Ver
// docs/MANUAL_REVIEW_VIEW.md § Acciones futuras.
export function FutureActionButton({ label }: FutureActionButtonProps) {
  return (
    <button
      type="button"
      disabled
      title="Disponible cuando se active Centro de Correcciones"
      className="cursor-not-allowed rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: "var(--eyg-border)", color: "var(--text-muted)", background: "#f2f5f4" }}
    >
      {label}
    </button>
  );
}
