interface AfterHoursEmptyBlockProps {
  title: string;
  description?: string;
  layout?: "row" | "column";
  tone?: "pending" | "error";
  onRetry?: () => void;
  retryLabel?: string;
}

// Bloque "sin datos todavía" con borde punteado - patrón repetido en cada
// sección vacía del prototipo (Nexus - Trabajo Fuera de Horario.dc.html):
// ícono + título + descripción, borde discontinuo, sin recuadro sólido.
// `layout="row"` para bloques anchos (Evolución, distribución de
// confianza); `layout="column"` para bloques angostos en grilla 2×2
// (rankings, tipo de tarea). Nunca oculta la tarjeta contenedora ni
// colapsa la grilla - el padre siempre reserva el mismo espacio.
export function AfterHoursEmptyBlock({ title, description, layout = "row", tone = "pending", onRetry, retryLabel = "Reintentar" }: AfterHoursEmptyBlockProps) {
  const isRow = layout === "row";
  const stroke = tone === "error" ? "#c0392b" : "#a7abc4";

  return (
    <div
      className={`flex items-center gap-3.5 rounded-[10px] border-[1.5px] border-dashed px-4 ${isRow ? "py-7" : "flex-col py-5.5 text-center"}`}
      style={{ borderColor: "var(--nx-border)" }}
    >
      {tone === "error" ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <circle cx="12" cy="16" r=".6" fill={stroke} />
        </svg>
      ) : (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17l6-6 4 4 8-9" />
          <path d="M3 21h18" />
        </svg>
      )}
      <div>
        <div className="text-[14.5px] font-bold" style={{ color: tone === "error" ? "#a03e2c" : "var(--nx-text-secondary)" }}>
          {title}
        </div>
        {description && (
          <div className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
            {description}
          </div>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-[var(--nx-radius-button)] px-3 py-1.5 text-[13px] font-semibold"
            style={{ color: "var(--nx-accent-indigo)", border: "1px solid var(--nx-border)", background: "var(--nx-card-bg)" }}
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
