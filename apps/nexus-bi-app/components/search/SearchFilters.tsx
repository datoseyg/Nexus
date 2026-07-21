"use client";

import type { ConRepuestoFilter } from "@/types/search";
import { BUTTON_TEXT_LINK, FORM_CONTROL, PILL_SELECTED_GREEN, PILL_UNSELECTED } from "./search.styles";

export interface SearchFilterValues {
  from?: string;
  to?: string;
  cliente?: string;
  maquina?: string;
  tipoTarea?: string;
  estadoTicket?: string;
  conRepuesto: ConRepuestoFilter;
}

interface SearchFiltersProps {
  values: SearchFilterValues;
  options: { clientes: string[]; maquinas: string[]; tiposTarea: string[]; estadosTicket: string[]; dateRange: { min: string | null; max: string | null } } | null;
  onChange: (patch: Partial<SearchFilterValues>) => void;
  onClear: () => void;
}

// Sizing/tipografía únicamente - el color/fondo/borde de reposo y de hover
// vive enteramente en FORM_CONTROL (search.styles.ts). Un `style` inline
// con border/background/color anularía cualquier regla :hover generada
// por Tailwind (mayor especificidad que una pseudo-clase) - esa fue la
// causa real de que los selects/inputs no mostraran feedback.
const CONTROL_SIZE_STYLE: React.CSSProperties = {
  borderRadius: "var(--nx-radius-button)",
  fontSize: 13,
  minWidth: 150,
  maxWidth: "100%",
  padding: "0 10px"
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toIsoDate(d);
}

const PERIOD_PRESETS: Array<{ label: string; range: () => { from?: string; to?: string } }> = [
  { label: "Todo", range: () => ({ from: undefined, to: undefined }) },
  { label: "Últimos 7 días", range: () => ({ from: daysAgo(7), to: toIsoDate(new Date()) }) },
  { label: "Últimos 30 días", range: () => ({ from: daysAgo(30), to: toIsoDate(new Date()) }) },
  {
    label: "Este mes",
    range: () => {
      const now = new Date();
      return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIsoDate(now) };
    }
  },
  {
    label: "Este año",
    range: () => {
      const now = new Date();
      return { from: toIsoDate(new Date(now.getFullYear(), 0, 1)), to: toIsoDate(now) };
    }
  }
];

// Controles reales (no chips estáticos fingiendo filtros): cada uno afecta
// el request y la URL (vía el padre, SearchDashboard). 44px de altura,
// labels reales, opción "Todos" en cada select.
export function SearchFilters({ values, options, onChange, onClear }: SearchFiltersProps) {
  function isActivePreset(preset: (typeof PERIOD_PRESETS)[number]): boolean {
    const range = preset.range();
    return range.from === values.from && range.to === values.to;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="sr-only">Período</span>
        {PERIOD_PRESETS.map(preset => {
          const active = isActivePreset(preset);
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
              className={`rounded-[var(--nx-radius-pill)] px-3.5 text-[12.5px] font-semibold ${active ? PILL_SELECTED_GREEN : PILL_UNSELECTED}`}
              onClick={() => onChange(preset.range())}
            >
              {preset.label}
            </button>
          );
        })}
        <label className="sr-only" htmlFor="search-from">
          Desde
        </label>
        <input
          id="search-from"
          type="date"
          value={values.from ?? ""}
          min={options?.dateRange.min ?? undefined}
          max={values.to ?? options?.dateRange.max ?? undefined}
          onChange={event => onChange({ from: event.target.value || undefined })}
          className={`rounded-[var(--nx-radius-button)] px-2 text-[12.5px] text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
        />
        <span style={{ color: "var(--nx-text-muted)" }}>a</span>
        <label className="sr-only" htmlFor="search-to">
          Hasta
        </label>
        <input
          id="search-to"
          type="date"
          value={values.to ?? ""}
          min={values.from ?? options?.dateRange.min ?? undefined}
          max={options?.dateRange.max ?? undefined}
          onChange={event => onChange({ to: event.target.value || undefined })}
          className={`rounded-[var(--nx-radius-button)] px-2 text-[12.5px] text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="search-cliente">
          Cliente
        </label>
        <select
          id="search-cliente"
          className={`text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
          style={CONTROL_SIZE_STYLE}
          value={values.cliente ?? ""}
          onChange={event => onChange({ cliente: event.target.value || undefined })}
        >
          <option value="">Cliente: Todos</option>
          {options?.clientes.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="search-maquina">
          Máquina
        </label>
        <select
          id="search-maquina"
          className={`text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
          style={CONTROL_SIZE_STYLE}
          value={values.maquina ?? ""}
          onChange={event => onChange({ maquina: event.target.value || undefined })}
        >
          <option value="">Máquina: Todas</option>
          {options?.maquinas.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="search-tipo-tarea">
          Tipo de tarea
        </label>
        <select
          id="search-tipo-tarea"
          className={`text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
          style={CONTROL_SIZE_STYLE}
          value={values.tipoTarea ?? ""}
          onChange={event => onChange({ tipoTarea: event.target.value || undefined })}
        >
          <option value="">Tipo de tarea: Todas</option>
          {options?.tiposTarea.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="search-estado-ticket">
          Estado del ticket
        </label>
        <select
          id="search-estado-ticket"
          className={`text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
          style={CONTROL_SIZE_STYLE}
          value={values.estadoTicket ?? ""}
          onChange={event => onChange({ estadoTicket: event.target.value || undefined })}
        >
          <option value="">Estado del ticket: Todos</option>
          {options?.estadosTicket.map(e => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="search-con-repuesto">
          Con repuesto
        </label>
        <select
          id="search-con-repuesto"
          className={`text-[var(--nx-text-primary)] ${FORM_CONTROL}`}
          style={CONTROL_SIZE_STYLE}
          value={values.conRepuesto}
          onChange={event => onChange({ conRepuesto: event.target.value as ConRepuestoFilter })}
        >
          <option value="all">Con repuesto: Todos</option>
          <option value="yes">Con repuesto: Sí</option>
          <option value="no">Con repuesto: No</option>
        </select>

        <button
          type="button"
          onClick={onClear}
          className={`ml-auto whitespace-nowrap px-2.5 text-[13px] font-semibold underline ${BUTTON_TEXT_LINK}`}
          style={{ color: "var(--nx-accent-indigo)", minHeight: 44 }}
        >
          Limpiar filtros
        </button>
      </div>
    </div>
  );
}
