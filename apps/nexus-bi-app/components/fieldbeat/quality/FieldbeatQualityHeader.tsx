interface FieldbeatQualityHeaderProps {
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  generatedAt: string | null;
  totalReportsLabel: string | null;
  clientCount: number | null;
  equipmentCount: number | null;
}

function formatDate(value: string | null): string {
  if (!value) return "sin límite";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

function formatTimestamp(value: string | null): string {
  if (!value) return "aún no disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Cabecera compacta (Phase 3 §5) - reemplaza a FieldbeatHeader.tsx (ver
// dead-code removal en el cierre de Phase 3: esa versión estaba atada al
// shell de una sola página, con el mismo copy fijo sin importar filtros -
// "Todo el historial disponible" ya no es cierto con la nueva arquitectura
// de filtros por pestaña). El botón de exportación queda como costura
// visible pero deshabilitada - PDF vive en una fase posterior (§2).
export function FieldbeatQualityHeader({ effectiveDateFrom, effectiveDateTo, generatedAt, totalReportsLabel, clientCount, equipmentCount }: FieldbeatQualityHeaderProps) {
  return (
    <div className="p-4 sm:p-5" style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[19px] font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
            Dashboard FieldBeat
          </h1>
          <p className="mt-0.5 max-w-[560px] text-[13px] leading-snug" style={{ color: "var(--nx-text-secondary)" }}>
            Calidad, trazabilidad y consistencia de los registros de terreno.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)" }}>
            Rango: {formatDate(effectiveDateFrom)} - {formatDate(effectiveDateTo)}
          </span>
          <span
            className="rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", color: "var(--nx-text-secondary)" }}
          >
            Actualizado: {formatTimestamp(generatedAt)}
          </span>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="La exportación a PDF llega en una fase posterior."
            className="flex cursor-not-allowed items-center gap-2 rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: "var(--nx-sidebar-bg)", color: "#ffffff", opacity: 0.55 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
              <path d="M4 19h16" />
            </svg>
            Exportar
          </button>
        </div>
      </div>
      {/* min-h reserva el espacio de esta línea antes de que lleguen los
          metadatos (Phase 3 reapertura §7) - sin esto el contenedor mide 0
          mientras carga y salta ~18px al llegar los datos, el mayor CLS
          medido en carga en frío (~0.15 de layout-shift). */}
      <div className="mt-2 flex min-h-[18px] flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: "var(--nx-text-muted)" }}>
        {totalReportsLabel && <span>{totalReportsLabel}</span>}
        {clientCount !== null && <span>{clientCount.toLocaleString("es-CL")} clientes en catálogo</span>}
        {equipmentCount !== null && <span>{equipmentCount.toLocaleString("es-CL")} equipos en catálogo</span>}
      </div>
    </div>
  );
}
