const COLUMNS: readonly string[] = ["Fecha y hora", "ID reporte", "Cliente", "Máquina", "Tipo de tarea", "Origen", "ID ticket", "SKU", "Cantidad descontada", "Estado"];

// "DETALLE / Últimos reportes de terreno" del mockup - se conserva la
// estructura real de la tabla (thead con las 10 columnas) para fidelidad
// visual, pero el cuerpo es un único estado honesto: no hay endpoint de
// detalle fila-a-fila (los 5 result sets son 1 fila, 6 filas o top-10
// agregados). Sin filas inventadas, sin el toggle demo
// Estándar/Cargando/Error del mockup (era solo de la demostración, no una
// capacidad real), sin filas clicables, sin paginación, sin drawer.
export function FieldbeatUnavailableDetailTable() {
  return (
    <div>
      <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
        Detalle
      </div>
      <div className="overflow-hidden rounded-[14px]" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="flex items-center gap-3 border-b p-3.5" style={{ borderColor: "var(--nx-page-bg)" }}>
          <div className="text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
            Últimos reportes de terreno
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <caption className="sr-only">Últimos reportes de terreno - detalle no disponible en el contrato actual</caption>
            <thead>
              <tr style={{ background: "var(--nx-page-bg)" }}>
                {COLUMNS.map(col => (
                  <th key={col} scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-left font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={COLUMNS.length} className="border-t p-0" style={{ borderColor: "var(--nx-page-bg)" }}>
                  <div className="flex items-center gap-3.5 p-5" role="status">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--nx-text-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12h4l2 3h6l2-3h4" />
                      <path d="M5 12l1.5-6h11L19 12" />
                      <path d="M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
                    </svg>
                    <div>
                      <div className="text-[14.5px] font-bold" style={{ color: "var(--nx-text-secondary)" }}>
                        Información todavía no disponible
                      </div>
                      <div className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
                        El detalle por reporte no está respaldado por el contrato actual (5 resultados agregados, sin fila a fila).
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
