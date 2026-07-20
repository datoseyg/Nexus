interface FieldbeatHeaderProps {
  recentActivityReason: string;
}

// ETAPA 5-V - reproduce el encabezado del mockup: título+subtítulo, chip
// "Todo el historial disponible", chip "Última actualización aún no
// disponible", botón "Descargar informe" deshabilitado (sin capacidad real
// de exportación) y la línea de actividad más reciente. Se renderiza
// SIEMPRE, sin importar el estado del fetch - contenido estructural, el
// marcador que usa scripts/smoke.mjs.
export function FieldbeatHeader({ recentActivityReason }: FieldbeatHeaderProps) {
  return (
    <div className="p-5 sm:p-7" style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[21px] font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
            Dashboard FieldBeat
          </h1>
          <p className="mt-1 max-w-[600px] text-sm leading-relaxed" style={{ color: "var(--nx-text-secondary)" }}>
            Toda la actividad de terreno registrada, tenga o no un ticket de soporte asociado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[13px] font-semibold" style={{ background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)" }}>
            Todo el historial disponible
          </span>
          <span
            className="rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-[13px]"
            style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", color: "var(--nx-text-secondary)" }}
          >
            Última actualización aún no disponible
          </span>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="La exportación aún no está respaldada por el contrato actual."
            className="flex cursor-not-allowed items-center gap-2 rounded-[var(--nx-radius-chip)] px-3.5 py-2 text-[13.5px] font-semibold"
            style={{ background: "var(--nx-sidebar-bg)", color: "#ffffff", opacity: 0.55 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
              <path d="M4 19h16" />
            </svg>
            Descargar informe
          </button>
          <span className="sr-only">La exportación aún no está respaldada por el contrato actual.</span>
        </div>
      </div>
      <div className="mt-2.5 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
        Actividad más reciente: <span style={{ color: "var(--nx-text-secondary)" }}>{recentActivityReason}</span>
      </div>
    </div>
  );
}
