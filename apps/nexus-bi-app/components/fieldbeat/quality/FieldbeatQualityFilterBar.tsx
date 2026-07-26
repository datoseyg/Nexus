"use client";

import { useMemo } from "react";
import { FilterBar } from "@/components/ui/FilterBar";
import { buildQuickRanges, activeQuickRangeKey as computeActiveQuickRangeKey, type QuickRange } from "@/lib/after-hours-filter-state";
import type { FieldbeatQualityFilters } from "@/lib/fieldbeat-quality-filters";
import type { FieldbeatQualityFilterOptions } from "@/types/fieldbeat-quality";

interface FilterChip {
  id: string;
  label: string;
}

const SEVERITY_LABELS: Record<string, string> = { Alta: "Severidad: Alta", Media: "Severidad: Media", Baja: "Severidad: Baja", Advertencia: "Severidad: Advertencia" };
const TICKET_STATUS_LABELS: Record<string, string> = { accessible: "Ticket: accesible", missing_or_restricted: "Ticket: ausente/restringido", none: "Sin ticket" };
const PART_STATUS_LABELS: Record<string, string> = {
  fully_traceable: "Repuestos: trazables",
  contains_placeholder: "Repuestos: con placeholder",
  contains_no_match: "Repuestos: sin match",
  contains_ambiguous: "Repuestos: ambiguos"
};

function buildChips(filters: FieldbeatQualityFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.client) chips.push({ id: "client", label: `Cliente: ${filters.client}` });
  if (filters.technician) chips.push({ id: "technician", label: `Técnico: ${filters.technician}` });
  if (filters.equipment) chips.push({ id: "equipment", label: `Equipo: ${filters.equipment}` });
  if (filters.taskType) chips.push({ id: "taskType", label: `Tipo de tarea: ${filters.taskType}` });
  if (filters.origin) chips.push({ id: "origin", label: `Origen: ${filters.origin}` });
  if (filters.ticketStatus) chips.push({ id: "ticketStatus", label: TICKET_STATUS_LABELS[filters.ticketStatus] });
  if (filters.partStatus) chips.push({ id: "partStatus", label: PART_STATUS_LABELS[filters.partStatus] });
  if (filters.qualityStatus) chips.push({ id: "qualityStatus", label: `Calidad: ${filters.qualityStatus}` });
  if (filters.inconsistencyCode) chips.push({ id: "inconsistencyCode", label: `Inconsistencia: ${filters.inconsistencyCode}` });
  if (filters.severity) chips.push({ id: "severity", label: SEVERITY_LABELS[filters.severity] });
  return chips;
}

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

interface FieldbeatQualityFilterBarProps {
  filters: FieldbeatQualityFilters;
  onChange: (next: FieldbeatQualityFilters) => void;
  onClear: () => void;
  filterOptions: FieldbeatQualityFilterOptions | null;
  moreFiltersOpen: boolean;
  onToggleMoreFilters: () => void;
}

// Contrato de filtros v2 (Phase 3 §5) - compacto: rango + cliente + técnico
// + tipo de tarea siempre visibles, el resto bajo "Más filtros" para no
// ocupar gran parte del primer viewport (§6). Reutiliza components/ui/FilterBar.tsx
// (mismo primitivo que la barra vieja de FieldBeat y After-Hours).
export function FieldbeatQualityFilterBar({ filters, onChange, onClear, filterOptions, moreFiltersOpen, onToggleMoreFilters }: FieldbeatQualityFilterBarProps) {
  const quickRanges = useMemo(() => buildQuickRanges(), []);
  const activeQuickRangeKey = useMemo(
    () => computeActiveQuickRangeKey(quickRanges, { from: filters.dateFrom, to: filters.dateTo }),
    [quickRanges, filters.dateFrom, filters.dateTo]
  );

  function set<K extends keyof FieldbeatQualityFilters>(key: K, value: FieldbeatQualityFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  function selectRange(range: QuickRange) {
    onChange({ ...filters, dateFrom: range.from, dateTo: range.to });
  }

  const REMOVE_HANDLERS: Record<string, () => void> = {
    client: () => set("client", undefined),
    technician: () => set("technician", undefined),
    equipment: () => set("equipment", undefined),
    taskType: () => set("taskType", undefined),
    origin: () => set("origin", undefined),
    ticketStatus: () => set("ticketStatus", undefined),
    partStatus: () => set("partStatus", undefined),
    qualityStatus: () => set("qualityStatus", undefined),
    inconsistencyCode: () => set("inconsistencyCode", undefined),
    severity: () => set("severity", undefined)
  };
  const chips = buildChips(filters);

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
          <select aria-label="Equipo" value={filters.equipment ?? ""} onChange={e => set("equipment", e.target.value || undefined)} style={selectStyle(!!filters.equipment)}>
            <option value="">Equipo: Todos</option>
            {(filterOptions?.equipos ?? []).map(eq => (
              <option key={eq} value={eq}>
                {eq}
              </option>
            ))}
          </select>
          <select
            aria-label="Origen"
            value={filters.origin ?? ""}
            onChange={e => set("origin", (e.target.value || undefined) as FieldbeatQualityFilters["origin"])}
            style={selectStyle(!!filters.origin)}
          >
            <option value="">Origen: Todos</option>
            {(filterOptions?.origenes ?? []).map(o => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select
            aria-label="Estado de ticket"
            value={filters.ticketStatus ?? ""}
            onChange={e => set("ticketStatus", (e.target.value || undefined) as FieldbeatQualityFilters["ticketStatus"])}
            style={selectStyle(!!filters.ticketStatus)}
          >
            <option value="">Ticket: Todos</option>
            <option value="accessible">Accesible</option>
            <option value="missing_or_restricted">Ausente o restringido</option>
            <option value="none">Sin ticket informado</option>
          </select>
          <select
            aria-label="Estado de repuestos"
            value={filters.partStatus ?? ""}
            onChange={e => set("partStatus", (e.target.value || undefined) as FieldbeatQualityFilters["partStatus"])}
            style={selectStyle(!!filters.partStatus)}
          >
            <option value="">Repuestos: Todos</option>
            <option value="fully_traceable">Completamente trazables</option>
            <option value="contains_placeholder">Con placeholder</option>
            <option value="contains_no_match">Con línea sin match</option>
            <option value="contains_ambiguous">Con línea ambigua</option>
          </select>
          <select
            aria-label="Estado de calidad del reporte"
            value={filters.qualityStatus ?? ""}
            onChange={e => set("qualityStatus", (e.target.value || undefined) as FieldbeatQualityFilters["qualityStatus"])}
            style={selectStyle(!!filters.qualityStatus)}
          >
            <option value="">Calidad: Todas</option>
            {(filterOptions?.qualityStatuses ?? []).map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label="Código de inconsistencia"
            value={filters.inconsistencyCode ?? ""}
            onChange={e => set("inconsistencyCode", (e.target.value || undefined) as FieldbeatQualityFilters["inconsistencyCode"])}
            style={selectStyle(!!filters.inconsistencyCode)}
          >
            <option value="">Inconsistencia: Todas</option>
            {(filterOptions?.inconsistencyCodes ?? []).map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label="Severidad"
            value={filters.severity ?? ""}
            onChange={e => set("severity", (e.target.value || undefined) as FieldbeatQualityFilters["severity"])}
            style={selectStyle(!!filters.severity)}
          >
            <option value="">Severidad: Todas</option>
            {(filterOptions?.severities ?? []).map(s => (
              <option key={s} value={s}>
                {s}
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
                <button type="button" onClick={REMOVE_HANDLERS[chip.id]} aria-label={`Quitar filtro: ${chip.label}`} style={{ color: "var(--nx-sidebar-text-secondary)" }}>
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
      <select aria-label="Cliente" value={filters.client ?? ""} onChange={e => set("client", e.target.value || undefined)} style={selectStyle(!!filters.client)}>
        <option value="">Cliente: Todos {filterOptions ? `(${filterOptions.clientes.length})` : ""}</option>
        {(filterOptions?.clientes ?? []).map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select aria-label="Técnico" value={filters.technician ?? ""} onChange={e => set("technician", e.target.value || undefined)} style={selectStyle(!!filters.technician)}>
        <option value="">Técnico: Todos {filterOptions ? `(${filterOptions.tecnicos.length})` : ""}</option>
        {(filterOptions?.tecnicos ?? []).map(t => (
          <option key={t} value={t}>
            {t}
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
    </FilterBar>
  );
}
