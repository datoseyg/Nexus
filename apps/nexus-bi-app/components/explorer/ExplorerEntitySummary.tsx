"use client";

interface ExplorerEntitySummaryProps {
  title: string;
  description: string;
  totalRows: number | undefined;
  activeFilterCount: number;
  onExport: () => void;
  exporting: boolean;
}

// Tarjeta blanca de resumen de entidad (sección 5 de la corrección de
// fidelidad visual) - título de negocio + descripción + acción de
// exportar a la derecha, y una fila de metadata real tras un divisor.
// "Última actualización" se omite deliberadamente en vez de fabricar una
// fecha: ninguna de las fuentes del Explorador expone hoy una marca de
// tiempo de actualización por registro (las tablas marts/processed se
// reconstruyen por el pipeline batch, sin timestamp de refresh capturado
// todavía) - mostrar un valor inventado sería peor que omitirlo.
export function ExplorerEntitySummary({ title, description, totalRows, activeFilterCount, onExport, exporting }: ExplorerEntitySummaryProps) {
  return (
    <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--nx-text-primary)" }}>
            {title}
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--nx-text-secondary)" }}>
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--nx-radius-button)] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--nx-accent-indigo)" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M4 20h16" />
          </svg>
          {exporting ? "Exportando…" : "Exportar resultados"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
        <span className="font-semibold" style={{ color: "var(--nx-text-primary)" }}>
          {typeof totalRows === "number" ? totalRows.toLocaleString("es-CL") : "…"} registros
        </span>
        <span style={{ color: "var(--nx-text-muted)" }}>Actualización sincronizada por el pipeline de datos (sin marca de tiempo por registro)</span>
        {activeFilterCount > 0 && (
          <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: "var(--nx-page-bg)", color: "var(--nx-accent-indigo)" }}>
            {activeFilterCount} filtro{activeFilterCount === 1 ? "" : "s"} activo{activeFilterCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
