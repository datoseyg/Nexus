"use client";

import { explorerFiltersFor, type ExplorerFilterDef, type ExplorerFilterOption } from "@/lib/explorer-filters-config";
import type { ExplorerFilters } from "@/lib/explorer-url-state";
import type { ExplorerEntity } from "@/types/explorer";

interface ExplorerFilterPanelProps {
  entity: ExplorerEntity;
  filters: ExplorerFilters;
  onChange: (key: keyof ExplorerFilters, value: string) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  /** Facets reales por clave dinámica (clientes, tipos de tarea, familia de
   * equipo, etc.) - scoped a la entidad activa, ver
   * GET /api/explorer/[entity]/facets. Nunca las 9 entidades cargadas de una. */
  dynamicOptions: Record<string, ExplorerFilterOption[]>;
}

function optionsFor(def: ExplorerFilterDef, dynamicOptions: Record<string, ExplorerFilterOption[]>): ExplorerFilterOption[] {
  if (def.staticOptions) return def.staticOptions;
  if (def.dynamicOptionsKey) return dynamicOptions[def.dynamicOptionsKey] ?? [];
  return [];
}

// Tarjeta blanca de filtros (sección 6 de la corrección de fidelidad
// visual) - controles reales por entidad (lib/explorer-filters-config.ts),
// nunca filtros de columna física. Entidades sin filtros estructurados
// declarados todavía muestran solo el mensaje de "sin filtros adicionales"
// en vez de fabricar un control sin datos reales detrás. "boolean" es un
// <select> tri-estado (Todos/Sí/No) - nunca un checkbox, porque "sin marcar"
// necesita significar "no filtra" (Todos), distinto de "No" (filtra a false).
export function ExplorerFilterPanel({ entity, filters, onChange, onClear, hasActiveFilters, dynamicOptions }: ExplorerFilterPanelProps) {
  const defs = explorerFiltersFor(entity);

  return (
    <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="flex flex-wrap items-end gap-3">
        {defs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--nx-text-muted)" }}>
            Esta entidad todavía no tiene filtros estructurados adicionales - usa la búsqueda de la barra de herramientas.
          </p>
        ) : (
          defs.map(def => (
            <label key={def.key} className="flex w-full flex-col gap-1 text-xs sm:w-auto" style={{ maxWidth: "100%" }}>
              <span style={{ color: "var(--nx-text-secondary)" }}>{def.label}</span>
              {def.kind === "date" ? (
                <input
                  type="date"
                  value={filters[def.key] ?? ""}
                  onChange={event => onChange(def.key, event.target.value)}
                  className="w-full rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5 text-sm sm:w-auto"
                  style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", maxWidth: "100%" }}
                />
              ) : (
                <select
                  value={filters[def.key] ?? ""}
                  onChange={event => onChange(def.key, event.target.value)}
                  className="w-full truncate rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5 text-sm sm:w-[180px]"
                  style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", maxWidth: "100%" }}
                >
                  <option value="">Todos</option>
                  {optionsFor(def, dynamicOptions).map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))
        )}

        {hasActiveFilters && (
          <button type="button" onClick={onClear} className="ml-auto text-xs font-semibold underline" style={{ color: "var(--nx-text-secondary)" }}>
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}
