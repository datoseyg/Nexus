import type { Grain } from "@/lib/dashboard-filters";
import { BASE_TRANSITION, FOCUS_RING as SHARED_FOCUS_RING } from "@/components/ui/interactive";

export interface DateRangeValue {
  from?: string;
  to?: string;
  grain: Grain;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  min?: string | null;
  max?: string | null;
}

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toIsoDate(d);
}

// Reemplaza el select estático "Selecciona un período" del dashboard de
// referencia por un calendario/rango real (desde-hasta + presets +
// agrupación), sin depender de ninguna librería de pago. Migrado a
// tokens --nx-* (presets estilo "quick range" del standalone).
const PRESETS: Array<{ label: string; range: () => { from?: string; to?: string } }> = [
  { label: "Hoy", range: () => ({ from: toIsoDate(new Date()), to: toIsoDate(new Date()) }) },
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
  },
  { label: "Todo", range: () => ({ from: undefined, to: undefined }) }
];

export function DateRangePicker({ value, onChange, min, max }: DateRangePickerProps) {
  function isActivePreset(preset: (typeof PRESETS)[number]): boolean {
    const range = preset.range();
    return range.from === value.from && range.to === value.to;
  }

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      {PRESETS.map(preset => {
        const active = isActivePreset(preset);
        return (
          <button
            key={preset.label}
            type="button"
            aria-pressed={active}
            className={`rounded-[var(--nx-radius-pill)] px-3 py-1.5 text-[12px] font-semibold cursor-pointer active:translate-y-px ${BASE_TRANSITION} ${SHARED_FOCUS_RING} ${
              active
                ? "bg-[var(--nx-accent-green)] text-white shadow-sm hover:bg-[#2f7024] hover:shadow-md active:bg-[#245a1c]"
                : "bg-[var(--nx-page-bg)] text-[var(--nx-text-secondary)] hover:bg-indigo-50 hover:text-indigo-900 active:bg-indigo-100"
            }`}
            style={{ minHeight: 32 }}
            onClick={() => onChange({ ...value, ...preset.range() })}
          >
            {preset.label}
          </button>
        );
      })}

      <input
        type="date"
        className={`rounded-[var(--nx-radius-button)] text-[12.5px] ${FOCUS_RING}`}
        style={{ border: "1px solid var(--nx-border)", color: "var(--nx-text-primary)", minHeight: 44, padding: "0 10px" }}
        value={value.from ?? ""}
        min={min ?? undefined}
        max={value.to ?? max ?? undefined}
        onChange={event => onChange({ ...value, from: event.target.value || undefined })}
        title="Desde"
        aria-label="Fecha desde"
      />
      <span className="text-xs" style={{ color: "var(--nx-text-muted)" }}>
        a
      </span>
      <input
        type="date"
        className={`rounded-[var(--nx-radius-button)] text-[12.5px] ${FOCUS_RING}`}
        style={{ border: "1px solid var(--nx-border)", color: "var(--nx-text-primary)", minHeight: 44, padding: "0 10px" }}
        value={value.to ?? ""}
        min={value.from ?? min ?? undefined}
        max={max ?? undefined}
        onChange={event => onChange({ ...value, to: event.target.value || undefined })}
        title="Hasta"
        aria-label="Fecha hasta"
      />

      <select
        className={`rounded-[var(--nx-radius-button)] text-[12.5px] ${FOCUS_RING}`}
        style={{ border: "1px solid var(--nx-border)", color: "var(--nx-text-primary)", minHeight: 44, padding: "0 10px" }}
        value={value.grain}
        onChange={event => onChange({ ...value, grain: event.target.value as Grain })}
        title="Agrupar por"
        aria-label="Agrupar por"
      >
        <option value="day">Día</option>
        <option value="week">Semana</option>
        <option value="month">Mes</option>
      </select>
    </div>
  );
}
