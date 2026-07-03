"use client";

import { useState } from "react";

interface FilterPanelProps {
  children: React.ReactNode;
  sticky?: boolean;
  title?: string;
}

// Panel de filtros genérico: sticky en desktop, colapsable en pantallas
// angostas (el usuario decide si lo necesita abierto) para que los
// filtros no empujen el contenido fuera de la vista en tablet/móvil — ver
// docs/VISUAL_REDESIGN_EYG.md § Responsive.
export function FilterPanel({ children, sticky = true, title = "Filtros" }: FilterPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={sticky ? "sticky top-0 z-10" : ""}
      style={{ background: "var(--page-plane)", paddingBottom: 6 }}
    >
      <div className="mb-2 flex items-center justify-between md:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {title}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="rounded-full border px-3 py-1 text-xs font-medium"
          style={{ borderColor: "var(--eyg-border)", color: "var(--text-secondary)", background: "var(--eyg-card)" }}
        >
          {collapsed ? "Mostrar filtros" : "Ocultar filtros"}
        </button>
      </div>
      <div className={collapsed ? "hidden md:block" : ""}>{children}</div>
    </div>
  );
}
