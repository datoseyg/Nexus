"use client";

import { useMemo } from "react";
import { FilterBar } from "@/components/ui/FilterBar";
import { getDataBasisLabel, getReasonCodeLabel, getWeekdayLabel, WEEKDAY_ORDER } from "@/lib/after-hours-labels";
import {
  activeQuickRangeKey as computeActiveQuickRangeKey,
  buildFilterChips,
  buildQuickRanges,
  isValidAfterHoursDateRange,
  type AfterHoursFilterState,
  type QuickRange
} from "@/lib/after-hours-filter-state";
import { optionKeysAsc } from "@/lib/after-hours-filter-options";
import type { AfterHoursByDimensionRow, AfterHoursDataBasis, AfterHoursSummary } from "@/types/after-hours";

export type { AfterHoursFilterState } from "@/lib/after-hours-filter-state";
export { EMPTY_FILTERS } from "@/lib/after-hours-filter-state";

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

interface AfterHoursFiltersProps {
  filters: AfterHoursFilterState;
  onChange: (next: AfterHoursFilterState) => void;
  onClear: () => void;
  filterOptions: AfterHoursSummary["filterOptions"] | null;
  // ETAPA 6.6D-FIX-1 - filas YA filtradas de by-technician/by-client (fecha
  // + demás filtros activos, autoexcluyendo solo su propia dimensión).
  // Reemplazan filterOptions.tecnicos/clientes como fuente de las opciones
  // Y el contador "(N)" del <select> - filterOptions.tecnicos/clientes
  // sigue existiendo (catálogo global, sin filtrar) pero ya no alimenta
  // estos dos selectores.
  technicianOptions: AfterHoursByDimensionRow[] | null;
  clientOptions: AfterHoursByDimensionRow[] | null;
  moreFiltersOpen: boolean;
  onToggleMoreFilters: () => void;
}

const CONFIDENCE_LEVELS = ["Alta", "Media", "Baja", "Insuficiente"];

// Barra de filtros de /dashboard/after-hours (ETAPA 6.6D §7), reconstruida
// sobre components/ui/FilterBar.tsx (slots quickAccess/children/
// moreFilters/chips, ya calca la estructura del prototipo). "Máquina" se
// omite a propósito: buildAfterHoursMartConditions (lib/after-hours-
// filters.ts) no ofrece un filtro de equipo fiable hoy - agregar un
// selector sin soporte real en la API violaría el principio de
// trazabilidad (09-design-principles.md #1).
export function AfterHoursFilters({
  filters,
  onChange,
  onClear,
  filterOptions,
  technicianOptions,
  clientOptions,
  moreFiltersOpen,
  onToggleMoreFilters
}: AfterHoursFiltersProps) {
  const quickRanges = useMemo(() => buildQuickRanges(), []);
  const activeQuickRangeKey = useMemo(() => computeActiveQuickRangeKey(quickRanges, filters), [quickRanges, filters.from, filters.to]);
  const technicianKeys = useMemo(() => optionKeysAsc(technicianOptions), [technicianOptions]);
  const clientKeys = useMemo(() => optionKeysAsc(clientOptions), [clientOptions]);
  // Sección 1 del encargo - activeQuickRangeKey ya devuelve null exactamente
  // cuando from/to no calzan con ningún preset (nunca cuando ambos están
  // vacíos - ese caso es "all") - por construcción, ese es el estado CUSTOM.
  const isCustomRange = activeQuickRangeKey === null;
  const dateRangeValid = isValidAfterHoursDateRange(filters.from, filters.to);

  function set<K extends keyof AfterHoursFilterState>(key: K, value: AfterHoursFilterState[K]) {
    onChange({ ...filters, [key]: value });
  }

  function selectRange(range: QuickRange) {
    onChange({ ...filters, from: range.from, to: range.to });
  }

  const REMOVE_HANDLERS: Record<string, () => void> = {
    client: () => set("client", undefined),
    technician: () => set("technician", undefined),
    taskType: () => set("taskType", undefined),
    dataBasis: () => set("dataBasis", undefined),
    confidenceLevel: () => set("confidenceLevel", undefined),
    onlyAfterHours: () => set("onlyAfterHours", undefined),
    onlyLowConfidence: () => set("onlyLowConfidence", undefined),
    fallbackUsed: () => set("fallbackUsed", undefined),
    coverageReasonCode: () => set("coverageReasonCode", undefined),
    contractualReasonCode: () => set("contractualReasonCode", undefined),
    // weekday solo (seteado desde este selector, o desde el gráfico de día
    // de la semana) se limpia solo; el chip compuesto "weekdayHour" (solo
    // existe cuando ambos vienen juntos desde el heatmap) limpia los dos a
    // la vez con una única acción - ver buildFilterChips.
    weekday: () => set("weekday", undefined),
    weekdayHour: () => onChange({ ...filters, weekday: undefined, hour: undefined })
  };
  const chips = buildFilterChips(filters).map(chip => ({ ...chip, onRemove: REMOVE_HANDLERS[chip.id] }));

  return (
    <>
    <FilterBar
      quickAccess={
        <>
          {quickRanges.map(range => (
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
          {isCustomRange && (
            <span
              className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[13px] font-semibold"
              style={{ background: "var(--nx-sidebar-bg)", color: "#fff" }}
            >
              CUSTOM
            </span>
          )}
          {/* Desde/Hasta - mismo patrón visual que el panel de filtros del
              Explorador (components/explorer/ExplorerFilterPanel.tsx):
              label + input type="date" con borde --nx-border. "Desde solo",
              "Hasta solo" y "Desde + Hasta" son todos válidos - ningún campo
              es obligatorio ni depende del otro para aplicarse. */}
          <label className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Desde
            <input
              type="date"
              aria-label="Fecha desde"
              value={filters.from ?? ""}
              onChange={e => set("from", e.target.value || undefined)}
              className="rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: dateRangeValid ? "var(--nx-border)" : "var(--nx-danger-fg, #c0392b)", background: "var(--nx-card-bg)", color: "var(--nx-text-primary)" }}
              aria-invalid={!dateRangeValid}
              aria-describedby={!dateRangeValid ? "after-hours-date-range-error" : undefined}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Hasta
            <input
              type="date"
              aria-label="Fecha hasta"
              value={filters.to ?? ""}
              onChange={e => set("to", e.target.value || undefined)}
              className="rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: dateRangeValid ? "var(--nx-border)" : "var(--nx-danger-fg, #c0392b)", background: "var(--nx-card-bg)", color: "var(--nx-text-primary)" }}
              aria-invalid={!dateRangeValid}
              aria-describedby={!dateRangeValid ? "after-hours-date-range-error" : undefined}
            />
          </label>
        </>
      }
      moreFilters={
        <>
          <select
            aria-label="Nivel de confianza"
            value={filters.confidenceLevel ?? ""}
            onChange={e => set("confidenceLevel", e.target.value || undefined)}
            style={selectStyle(!!filters.confidenceLevel)}
          >
            <option value="">Nivel de confianza: Todos</option>
            {CONFIDENCE_LEVELS.map(level => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            <input type="checkbox" checked={filters.onlyAfterHours ?? false} onChange={e => set("onlyAfterHours", e.target.checked || undefined)} />
            Solo fuera de horario
          </label>
          <label className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            <input type="checkbox" checked={filters.onlyLowConfidence ?? false} onChange={e => set("onlyLowConfidence", e.target.checked || undefined)} />
            Solo baja confianza
          </label>
          <label className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            <input type="checkbox" checked={filters.fallbackUsed ?? false} onChange={e => set("fallbackUsed", e.target.checked || undefined)} />
            Solo con fallback
          </label>

          <select
            aria-label="Día de la semana"
            value={filters.weekday ?? ""}
            onChange={e => set("weekday", e.target.value ? Number(e.target.value) : undefined)}
            style={selectStyle(filters.weekday !== undefined)}
          >
            <option value="">Día de la semana: Todos</option>
            {WEEKDAY_ORDER.map(iso => (
              <option key={iso} value={iso}>
                {getWeekdayLabel(iso)}
              </option>
            ))}
          </select>

          <select
            aria-label="Motivo final"
            value={filters.coverageReasonCode ?? ""}
            onChange={e => set("coverageReasonCode", e.target.value || undefined)}
            style={selectStyle(!!filters.coverageReasonCode)}
          >
            <option value="">Motivo final: Todos</option>
            {(filterOptions?.coverageReasonCodes ?? []).map(code => (
              <option key={code} value={code}>
                {getReasonCodeLabel(code).label}
              </option>
            ))}
          </select>
          <select
            aria-label="Motivo contractual"
            value={filters.contractualReasonCode ?? ""}
            onChange={e => set("contractualReasonCode", e.target.value || undefined)}
            style={selectStyle(!!filters.contractualReasonCode)}
          >
            <option value="">Motivo contractual: Todos</option>
            {(filterOptions?.contractualReasonCodes ?? []).map(code => (
              <option key={code} value={code}>
                {getReasonCodeLabel(code).label}
              </option>
            ))}
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
      {/* HOTFIX auditoría After-Hours (§5): filtra por responsable principal
          (assigned_to) - este pipeline nunca tuvo participantes adicionales,
          el aria-label lo deja explícito para no implicar "cualquiera que
          haya trabajado la tarea". */}
      <select aria-label="Técnico responsable" value={filters.technician ?? ""} onChange={e => set("technician", e.target.value || undefined)} style={selectStyle(!!filters.technician)}>
        <option value="">Técnico responsable: Todos {technicianOptions ? `(${technicianKeys.length})` : ""}</option>
        {technicianKeys.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select aria-label="Cliente" value={filters.client ?? ""} onChange={e => set("client", e.target.value || undefined)} style={selectStyle(!!filters.client)}>
        <option value="">Cliente: Todos {clientOptions ? `(${clientKeys.length})` : ""}</option>
        {clientKeys.map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select aria-label="Tipo de tarea" value={filters.taskType ?? ""} onChange={e => set("taskType", e.target.value || undefined)} style={selectStyle(!!filters.taskType)}>
        <option value="">Tipo de tarea: Todas {filterOptions ? `(${filterOptions.tiposTarea.length})` : ""}</option>
        {(filterOptions?.tiposTarea ?? []).map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select aria-label="Base de cálculo" value={filters.dataBasis ?? ""} onChange={e => set("dataBasis", (e.target.value || undefined) as AfterHoursDataBasis | undefined)} style={selectStyle(!!filters.dataBasis)}>
        <option value="">Base de cálculo: Todas</option>
        {(filterOptions?.dataBases ?? []).map(basis => (
          <option key={basis} value={basis}>
            {getDataBasisLabel(basis).label}
          </option>
        ))}
      </select>
    </FilterBar>
    {!dateRangeValid && (
      <p id="after-hours-date-range-error" role="alert" className="mt-1.5 text-[13px]" style={{ color: "var(--nx-danger-fg, #c0392b)" }}>
        La fecha Desde debe ser anterior o igual a Hasta.
      </p>
    )}
    </>
  );
}
