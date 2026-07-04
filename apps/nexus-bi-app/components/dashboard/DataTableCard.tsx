import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import styles from "./dashboard.module.css";

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  render?: (row: Row, index: number) => React.ReactNode;
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
}

// Chrome de tabla delegado a ResponsiveTableShell (scroll + header sticky
// + estado vacío) - ver docs/VISUAL_REDESIGN_EYG.md. Esta capa solo arma
// las filas/columnas específicas del dashboard (celdas custom, click de
// fila para cross-filter).
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
  onRowClick
}: DataTableCardProps<Row>) {
  return (
    <ResponsiveTableShell
      title={title}
      count={totalRows}
      maxHeight={360}
      empty={rows.length === 0}
      beforeTable={headerExtra}
      footer={
        <div className={styles.pagination} style={{ paddingTop: 0 }}>
          {footerNote && <span style={{ marginRight: "auto" }}>{footerNote}</span>}
          <span>Página {page} de {totalPages}</span>
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            ‹
          </button>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
            ›
          </button>
        </div>
      }
    >
      <table>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} onClick={onRowClick ? () => onRowClick(row) : undefined} style={onRowClick ? { cursor: "pointer" } : undefined}>
              {columns.map(col => {
                const content = col.render ? col.render(row, index) : String((row as Record<string, unknown>)[col.key] ?? "");
                return (
                  <td key={col.key}>
                    {typeof content === "string" ? <span title={content}>{content}</span> : content}
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
