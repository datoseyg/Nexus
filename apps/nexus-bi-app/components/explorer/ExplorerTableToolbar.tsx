"use client";

import { useState } from "react";
import type { ExplorerColumn } from "@/lib/explorer-entity-config";
import type { TableDensity } from "@/components/ui/ResponsiveTableShell";

interface ExplorerTableToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onQueryCommit: () => void;
  columns: ExplorerColumn[];
  hiddenColumns: Set<string>;
  onToggleColumn: (key: string) => void;
  density: TableDensity;
  onDensityChange: (density: TableDensity) => void;
}

// Barra de herramientas de tabla (sección 7 de la corrección de fidelidad
// visual) - búsqueda dentro del conjunto ya filtrado, columnas visibles
// (solo alterna columnas ya allowlisted marcadas optional, NUNCA revela un
// campo nuevo ni consulta information_schema) y densidad (altura/padding de
// fila, nunca el tamaño de fuente base).
export function ExplorerTableToolbar({
  query,
  onQueryChange,
  onQueryCommit,
  columns,
  hiddenColumns,
  onToggleColumn,
  density,
  onDensityChange
}: ExplorerTableToolbarProps) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const optionalColumns = columns.filter(c => c.optional);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
      <form
        className="min-w-[200px] flex-1"
        onSubmit={event => {
          event.preventDefault();
          onQueryCommit();
        }}
      >
        <input
          type="text"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onBlur={onQueryCommit}
          placeholder="Buscar dentro de este conjunto…"
          className="w-full rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--nx-border)", background: "var(--nx-page-bg)" }}
        />
      </form>

      {optionalColumns.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setColumnsOpen(v => !v)}
            aria-expanded={columnsOpen}
            className="rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
          >
            Columnas visibles
          </button>
          {columnsOpen && (
            <>
              <button type="button" aria-label="Cerrar" className="fixed inset-0 z-10 cursor-default" onClick={() => setColumnsOpen(false)} />
              <div
                className="absolute right-0 z-20 mt-1.5 flex w-56 flex-col gap-1.5 rounded-[var(--nx-radius-card)] border p-3"
                style={{ background: "var(--nx-card-bg)", borderColor: "var(--nx-border)", boxShadow: "var(--nx-shadow-card)" }}
              >
                {optionalColumns.map(col => (
                  <label key={col.key} className="flex items-center gap-2 text-sm" style={{ color: "var(--nx-text-primary)" }}>
                    <input type="checkbox" checked={!hiddenColumns.has(col.key)} onChange={() => onToggleColumn(col.key)} />
                    {col.header}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-0.5 rounded-[var(--nx-radius-chip)] border p-0.5" style={{ borderColor: "var(--nx-border)" }}>
        {(["comfortable", "compact"] as TableDensity[]).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onDensityChange(option)}
            aria-pressed={density === option}
            className="rounded-[var(--nx-radius-chip)] px-2.5 py-1 text-xs font-semibold"
            style={{
              background: density === option ? "var(--nx-sidebar-bg)" : "transparent",
              color: density === option ? "var(--nx-sidebar-text-primary)" : "var(--nx-text-secondary)"
            }}
          >
            {option === "comfortable" ? "Normal" : "Compacta"}
          </button>
        ))}
      </div>
    </div>
  );
}
