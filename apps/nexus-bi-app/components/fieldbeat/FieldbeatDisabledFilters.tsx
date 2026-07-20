const QUICK_RANGES: readonly string[] = ["Hoy", "7 días", "30 días", "Este mes", "Este año", "Todo"];
const FILTER_CHIPS: readonly string[] = ["Cliente: Todos", "Máquina: Todas", "Tipo de tarea: Todas", "Origen: Todos"];
const MORE_FILTER_CHIPS: readonly string[] = ["Con ticket asociado: Todos", "Con repuesto registrado: Todos"];

const DISABLED_REASON = "Los filtros no están disponibles en el contrato actual de esta vista - representa siempre todo el historial.";

function disabledChipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--nx-sidebar-bg)" : "var(--nx-page-bg)",
    color: active ? "#ffffff" : "var(--nx-text-secondary)",
    opacity: active ? 1 : 0.6
  };
}

// ETAPA 5-V - reproduce visualmente la barra de filtros del mockup, pero
// como el backend no acepta ningún parámetro, TODOS los controles quedan
// deshabilitados salvo "Todo" (siempre activo, es lo único que esta
// pantalla realmente representa). Ningún control dispara fetch ni cambia
// resultados - no hay onClick/onChange en ningún elemento de este
// componente, es estructuralmente imposible que module datos.
export function FieldbeatDisabledFilters() {
  return (
    <div className="rounded-xl p-3.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <span className="sr-only">{DISABLED_REASON}</span>

      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {QUICK_RANGES.map(range => {
          const active = range === "Todo";
          return (
            <button
              key={range}
              type="button"
              disabled={!active}
              aria-disabled={!active}
              title={active ? "Único rango disponible en esta vista" : DISABLED_REASON}
              className={`rounded-[6px] px-3 py-1.5 text-[13px] font-semibold ${active ? "" : "cursor-not-allowed"}`}
              style={disabledChipStyle(active)}
            >
              {range}
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--nx-border)" }} aria-hidden="true" />
        <span className="px-1 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
          Rango manual no disponible
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_CHIPS.map(chip => (
          <span key={chip} title={DISABLED_REASON} aria-disabled="true" className="cursor-not-allowed rounded-[7px] px-3 py-1.5 text-[13px]" style={{ background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)", opacity: 0.6 }}>
            {chip}
          </span>
        ))}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={DISABLED_REASON}
          className="ml-auto cursor-not-allowed rounded-[7px] border px-3 py-1.5 text-[13px] font-semibold"
          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" }}
        >
          Más filtros
        </button>
        <button type="button" disabled aria-disabled="true" title={DISABLED_REASON} className="cursor-not-allowed text-[13px] underline" style={{ color: "var(--nx-text-muted)" }}>
          Limpiar filtros
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2 border-t pt-2.5" style={{ borderColor: "var(--nx-page-bg)" }}>
        {MORE_FILTER_CHIPS.map(chip => (
          <span key={chip} title={DISABLED_REASON} aria-disabled="true" className="cursor-not-allowed rounded-[7px] px-3 py-1.5 text-[13px]" style={{ background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)", opacity: 0.6 }}>
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
