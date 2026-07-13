"use client";

import { BUTTON_ICON } from "./search.styles";

interface SearchPaginationProps {
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}

// Reemplaza components/PaginationControls.tsx (genérico, sin estados de
// interacción propios) para esta vista - ese componente sigue existiendo
// sin modificar, solo se deja de usar acá. Anterior/Siguiente con
// hover/focus/active/disabled reales; sin números de página clickeables
// (mismo alcance que el componente genérico), por lo que aria-current no
// aplica - la página actual se anuncia como texto plano.
export function SearchPagination({ page, totalPages, totalRows, onPageChange }: SearchPaginationProps) {
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    <div className="flex items-center justify-between gap-3 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
      <span className="tabular-nums">
        Página {page} de {totalPages} · {totalRows.toLocaleString("es-CL")} filas totales
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={atFirst}
          aria-label="Página anterior"
          className={`flex h-11 w-11 items-center justify-center rounded-[var(--nx-radius-button)] border ${BUTTON_ICON}`}
          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)", background: "#ffffff" }}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={atLast}
          aria-label="Página siguiente"
          className={`flex h-11 w-11 items-center justify-center rounded-[var(--nx-radius-button)] border ${BUTTON_ICON}`}
          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)", background: "#ffffff" }}
        >
          ›
        </button>
      </div>
    </div>
  );
}
