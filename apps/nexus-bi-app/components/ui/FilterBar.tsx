"use client";

import { useId } from "react";

interface FilterBarProps {
  quickAccess?: React.ReactNode;
  children: React.ReactNode;
  moreFilters?: React.ReactNode;
  moreFiltersOpen?: boolean;
  onToggleMoreFilters?: () => void;
  moreFiltersLabel?: string;
  chips?: React.ReactNode;
  actions?: React.ReactNode;
}

// Componente de composición/slots para la barra de filtros, sin lógica ni
// vocabulario de negocio (nada de "cliente", "máquina", "auditoría",
// "endpoint" vive acá). Resuelve únicamente layout, accesibilidad y
// estructura visual - cada pantalla mantiene su propio estado y lógica de
// filtros y le pasa contenido ya armado.
//
// Completamente controlado: no guarda moreFiltersOpen en estado propio.
// La pantalla es dueña de ese estado y lo pasa por prop;
// onToggleMoreFilters solo solicita el cambio, no lo aplica.
//
// Los componentes existentes (components/dashboard/FilterBar.tsx,
// components/audit/AuditFilterBar.tsx) no se tocan ni se borran - siguen
// sirviendo a las pantallas actuales hasta que una etapa posterior migre
// cada una. Este componente todavía no está conectado a ninguna pantalla.
export function FilterBar({
  quickAccess,
  children,
  moreFilters,
  moreFiltersOpen = false,
  onToggleMoreFilters,
  moreFiltersLabel,
  chips,
  actions
}: FilterBarProps) {
  const moreFiltersPanelId = useId();
  const label = moreFiltersLabel ?? (moreFiltersOpen ? "Menos filtros" : "Más filtros");

  return (
    <div
      className="rounded-[var(--nx-radius-card)] p-3.5"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      {quickAccess && <div className="mb-2.5 flex flex-wrap gap-1.5">{quickAccess}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {children}

        {moreFilters && (
          <button
            type="button"
            aria-expanded={moreFiltersOpen}
            aria-controls={moreFiltersPanelId}
            onClick={onToggleMoreFilters}
            className="rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-[13px] font-semibold"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-accent-indigo)" }}
          >
            {label}
          </button>
        )}

        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {moreFilters && (
        <div
          id={moreFiltersPanelId}
          hidden={!moreFiltersOpen}
          className="mt-2.5 flex flex-wrap gap-2 border-t border-dashed pt-2.5"
          style={{ borderColor: "var(--nx-border)" }}
        >
          {moreFilters}
        </div>
      )}

      {chips && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--nx-border)" }}>
          {chips}
        </div>
      )}
    </div>
  );
}
