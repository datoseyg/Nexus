import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  render?: (row: Row, index: number) => React.ReactNode;
  /** Ancho mínimo de esta columna (th+td), en px. Sin valor -> ancho automático. */
  minWidthPx?: number;
  /** Permite que el encabezado y el contenido de esta columna envuelvan en
   * vez de recortarse en una sola línea (ResponsiveTableShell, fuera de
   * alcance, aplica white-space:nowrap por defecto - se sobrescribe acá
   * con estilo inline por columna, sin tocar ese archivo). */
  wrap?: boolean;
  /** Como `wrap`, pero corta dentro de tokens largos sin espacios (ej. SKU). */
  breakWord?: boolean;
}

interface DataTableCardProps<Row> {
  title: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  headerExtra?: React.ReactNode;
  footerNote?: string;
  onRowClick?: (row: Row) => void;
  /** Ancho mínimo total de la tabla - fuerza el scroll horizontal contenido
   * de ResponsiveTableShell en vez de comprimir columnas hasta cortar
   * encabezados. */
  tableMinWidthPx?: number;
}

const PAGE_BUTTON_STYLE: React.CSSProperties = {
  border: "1px solid var(--nx-border)",
  background: "#ffffff",
  color: "var(--nx-text-primary)",
  borderRadius: "var(--nx-radius-button)",
  minWidth: 44,
  minHeight: 44
};

function cellStyle<Row>(col: DataTableColumn<Row>): React.CSSProperties | undefined {
  if (!col.minWidthPx && !col.wrap && !col.breakWord) return undefined;
  return {
    minWidth: col.minWidthPx,
    whiteSpace: col.wrap || col.breakWord ? "normal" : undefined,
    wordBreak: col.breakWord ? "break-word" : undefined
  };
}

// Chrome de tabla delegado a ResponsiveTableShell (scroll + header sticky
// + estado vacío, components/ui - sin tocar). Esta capa solo arma las
// filas/columnas específicas del dashboard (celdas custom, click de fila
// para cross-filter) y el pie de paginación, migrado a tokens --nx-*.
//
// Corrección visual: `maxHeight` ya no se fija en 360px acá - estas tablas
// solo muestran su página actual (5-10 filas), así que un techo bajo
// generaba scroll vertical interno innecesario además del scroll de
// página. Se deja crecer verticalmente (`maxHeight="none"`) salvo que un
// consumidor futuro pase un valor explícito por una razón real.
export function DataTableCard<Row extends object>({
  title,
  columns,
  rows,
  page,
  totalPages,
  totalRows,
  onPageChange,
  headerExtra,
  footerNote,
  onRowClick,
  tableMinWidthPx
}: DataTableCardProps<Row>) {
  return (
    <ResponsiveTableShell
      title={title}
      count={totalRows}
      maxHeight="none"
      empty={rows.length === 0}
      beforeTable={headerExtra}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3 text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
          {footerNote && <span className="mr-auto">{footerNote}</span>}
          <span>
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            style={PAGE_BUTTON_STYLE}
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)] disabled:opacity-40"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Página anterior"
          >
            ‹
          </button>
          <button
            type="button"
            style={PAGE_BUTTON_STYLE}
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)] disabled:opacity-40"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Página siguiente"
          >
            ›
          </button>
        </div>
      }
    >
      <table style={{ minWidth: tableMinWidthPx }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={cellStyle(col)}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} onClick={onRowClick ? () => onRowClick(row) : undefined} style={onRowClick ? { cursor: "pointer" } : undefined}>
              {columns.map(col => {
                const content = col.render ? col.render(row, index) : String((row as Record<string, unknown>)[col.key] ?? "");
                const style = { ...cellStyle(col), paddingTop: 10, paddingBottom: 10 };
                return (
                  <td key={col.key} style={style}>
                    {typeof content === "string" ? <span title={col.wrap || col.breakWord ? undefined : content}>{content}</span> : content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTableShell>
  );
}
