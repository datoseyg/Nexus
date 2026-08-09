interface FutureActionButtonProps {
  label: string;
  /** Explica POR QUÉ esta acción específica no está disponible - el genérico
   * "Centro de Correcciones" quedó desactualizado una vez que la mayoría de
   * los comandos de gobierno ya se conectaron (Gate B, Familias 1-7): las
   * pocas acciones que siguen acá no esperan una activación general, sino
   * que no corresponden a ningún comando definido en el catálogo de diseño
   * (Gate B B8/B10) - inventar uno ahora violaría "nunca inventar una regla
   * o mecanismo sin diseño real" (instrucción explícita del programa). */
  reason?: string;
}

// Botón de acción de curación NO implementada todavía en este corte -
// visible y claramente marcado como futuro, nunca oculto en silencio. Ver
// docs/MANUAL_REVIEW_VIEW.md § Acciones futuras.
export function FutureActionButton({ label, reason = "Sin comando de gobierno diseñado para esta acción todavía." }: FutureActionButtonProps) {
  return (
    <button
      type="button"
      disabled
      title={reason}
      className="cursor-not-allowed rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-page-bg)" }}
    >
      {label}
    </button>
  );
}
