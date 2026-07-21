"use client";

import { useMemo } from "react";
import { FilterBar } from "@/components/ui/FilterBar";
import { buildQuickRanges, activeQuickRangeKey as computeActiveQuickRangeKey, type QuickRange } from "@/lib/after-hours-filter-state";
import { buildFilterChips, type FieldbeatFilterState } from "@/lib/fieldbeat-filter-state";
import type { FieldbeatFilterOptions } from "@/types/fieldbeat";

export { EMPTY_FILTERS } from "@/lib/fieldbeat-filter-state";
export type { FieldbeatFilterState } from "@/lib/fieldbeat-filter-state";

function selectStyle(hasValue: boolean): React.CSSProperties {
  return {
    background: "var(--nx-page-bg)",
    color: hasValue ? "var(--nx-text-primary)" : "var(--nx-text-secondary)",
    border: "none",
    borderRadius: "var(--nx-radius-chip)",
    padding: "7px 12px",
    fontSize: 13,
    fontWeight: hasValue ? 600 : 400
  };
}

interface FieldbeatFilterBarProps {
  filters: FieldbeatFilterState;
  onChange: (next: FieldbeatFilterState) => void;
  onClear: () => void;
  filterOptions: FieldbeatFilterOptions | null;
  moreFiltersOpen: boolean;
  onToggleMoreFilters: () => void;
}

// ETAPA 6 - reemplaza a FieldbeatDisabledFilters.tsx (ETAPA 5-V: "el
// backend no acepta ningún parámetro" - eso ya no es cierto, ver
// app/api/dashboard/fieldbeat/{filters,activity,detail}/route.ts). Mismo
// componente base (components/ui/FilterBar.tsx) y misma estructura que
// AfterHoursFilters.tsx - período predefinido/rango manual, cliente,
// equipo, tipo de tarea, origen, con/sin ticket, con/sin repuesto (Fase 5
// del encargo).
export function FieldbeatFilterBar({ filters, onChange, onClear, filterOptions, moreFiltersOpen, onToggleMoreFilters }: FieldbeatFilterBarProps) {
  const quickRanges = useMemo(() => buildQuickRanges(), []);
  const activeQuickRangeKey = useMemo(() => computeActiveQuickRangeKey(quickRanges, filters), [quickRanges, filters.from, filters.to]);

  function set<K extends keyof FieldbeatFilterState>(key: K, value: FieldbeatFilterState[K]) {
    onChange({ ...filters, [key]: value });
  }

  function selectRange(range: QuickRange) {
    onChange({ ...filters, from: range.from, to: range.to });
  }

  const REMOVE_HANDLERS: Record<string, () => void> = {
    cliente: () => set("cliente", undefined),
    equipo: () => set("equipo", undefined),
    tipoTarea: () => set("tipoTarea", undefined),
    origen: () => set("origen", undefined),
    conTicket: () => set("conTicket", undefined),
    conRepuesto: () => set("conRepuesto", undefined)
  };
  const chips = buildFilterChips(filters).map(chip => ({ ...chip, onRemove: REMOVE_HANDLERS[chip.id] }));

  function triStateValue(value: boolean | undefined): string {
    if (value === true) return "true";
    if (value === false) return "false";
    return "";
  }

  return (
    <FilterBar
      quickAccess={quickRanges.map(range => (
        <button
          key={range.key}
          type="button"
          onClick={() => selectRange(range)}
          className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[13px] font-semibold"
          style={{
            background: activeQuickRangeKey === range.key ? "var(--nx-sidebar-bg)" : "var(--nx-page-bg)",
            color: activeQuickRangeKey === range.key ? "#fff" : "var(--nx-text-primary)"
          }}
        >
          {range.label}
        </button>
      ))}
      moreFilters={
        <>
          <select
            aria-label="Con ticket asociado"
            value={triStateValue(filters.conTicket)}
            onChange={e => set("conTicket", e.target.value === "" ? undefined : e.target.value === "true")}
            style={selectStyle(filters.conTicket !== undefined)}
          >
            <option value="">Con ticket asociado: Todos</option>
            <option value="true">Con ticket</option>
            <option value="false">Sin ticket</option>
          </select>

          <select
            aria-label="Con repuesto registrado"
            value={triStateValue(filters.conRepuesto)}
            onChange={e => set("conRepuesto", e.target.value === "" ? undefined : e.target.value === "true")}
            style={selectStyle(filters.conRepuesto !== undefined)}
          >
            <option value="">Con repuesto registrado: Todos</option>
            <option value="true">Con repuesto</option>
            <option value="false">Sin repuesto</option>
          </select>
        </>
      }
      moreFiltersOpen={moreFiltersOpen}
      onToggleMoreFilters={onToggleMoreFilters}
      actions={
        <button type="button" onClick={onClear} className="text-[13px] underline" style={{ color: "var(--nx-text-muted)" }}>
          Limpiar filtros
        </button>
      }
      chips={
        chips.length > 0 && (
          <>
            <span className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
              Filtros aplicados:
            </span>
            {chips.map(chip => (
              <span
                key={chip.id}
                className="inline-flex items-center gap-1.5 rounded-[var(--nx-radius-pill)] py-1.5 pr-2 pl-3 text-[13px]"
                style={{ background: "var(--nx-sidebar-bg)", color: "#fff" }}
              >
                {chip.label}
                <button type="button" onClick={chip.onRemove} aria-label={`Quitar filtro: ${chip.label}`} style={{ color: "var(--nx-sidebar-text-secondary)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </>
        )
      }
    >
      <select aria-label="Cliente" value={filters.cliente ?? ""} onChange={e => set("cliente", e.target.value || undefined)} style={selectStyle(!!filters.cliente)}>
        <option value="">Cliente: Todos {filterOptions ? `(${filterOptions.clientes.length})` : ""}</option>
        {(filterOptions?.clientes ?? []).map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select aria-label="Equipo" value={filters.equipo ?? ""} onChange={e => set("equipo", e.target.value || undefined)} style={selectStyle(!!filters.equipo)}>
        <option value="">Máquina: Todas {filterOptions ? `(${filterOptions.equipos.length})` : ""}</option>
        {(filterOptions?.equipos ?? []).map(eq => (
          <option key={eq} value={eq}>
            {eq}
          </option>
        ))}
      </select>

      <select aria-label="Tipo de tarea" value={filters.tipoTarea ?? ""} onChange={e => set("tipoTarea", e.target.value || undefined)} style={selectStyle(!!filters.tipoTarea)}>
        <option value="">Tipo de tarea: Todas {filterOptions ? `(${filterOptions.tiposTarea.length})` : ""}</option>
        {(filterOptions?.tiposTarea ?? []).map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select
        aria-label="Origen"
        value={filters.origen ?? ""}
        onChange={e => set("origen", (e.target.value || undefined) as FieldbeatFilterState["origen"])}
        style={selectStyle(!!filters.origen)}
      >
        <option value="">Origen: Todos</option>
        {(filterOptions?.origenes ?? []).map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </FilterBar>
  );
}
