interface PaginationControlsProps {
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ page, totalPages, totalRows, onPageChange }: PaginationControlsProps) {
  return (
    <div className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
      <span className="tabular-nums">
        Página {page} de {totalPages} - {totalRows.toLocaleString("es-CL")} filas totales
      </span>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded border px-3 py-1 disabled:opacity-40"
          style={{ borderColor: "var(--border)" }}
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded border px-3 py-1 disabled:opacity-40"
          style={{ borderColor: "var(--border)" }}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
