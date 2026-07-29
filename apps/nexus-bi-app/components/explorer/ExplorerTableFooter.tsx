"use client";

interface ExplorerTableFooterProps {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  contextLabel: string;
}

// Footer de tabla (sección 10 de la corrección de fidelidad visual) -
// izquierda: información contextual real (nunca un texto de ejemplo);
// derecha: página actual/total + tamaño de página + anterior/siguiente.
export function ExplorerTableFooter({ page, totalPages, pageSize, onPageChange, contextLabel }: ExplorerTableFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
      <span>{contextLabel}</span>
      <div className="flex items-center gap-2">
        <span>
          Página {page} de {totalPages} · {pageSize} registros por página
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
          className="flex h-8 w-8 items-center justify-center rounded border disabled:opacity-40"
          style={{ borderColor: "var(--nx-border)" }}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Página siguiente"
          className="flex h-8 w-8 items-center justify-center rounded border disabled:opacity-40"
          style={{ borderColor: "var(--nx-border)" }}
        >
          ›
        </button>
      </div>
    </div>
  );
}
