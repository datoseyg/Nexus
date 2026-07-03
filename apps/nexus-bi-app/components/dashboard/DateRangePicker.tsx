import styles from "./dashboard.module.css";
import type { Grain } from "@/lib/dashboard-filters";

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
// agrupación), sin depender de ninguna librería de pago — ver
// docs/DASHBOARD_VISUAL_STYLE.md.
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
    <div className={styles.dateRangeBar}>
      {PRESETS.map(preset => (
        <button
          key={preset.label}
          type="button"
          className={`${styles.datePreset} ${isActivePreset(preset) ? styles.datePresetActive : ""}`}
          onClick={() => onChange({ ...value, ...preset.range() })}
        >
          {preset.label}
        </button>
      ))}

      <input
        type="date"
        className={styles.dateInput}
        value={value.from ?? ""}
        min={min ?? undefined}
        max={value.to ?? max ?? undefined}
        onChange={event => onChange({ ...value, from: event.target.value || undefined })}
        title="Desde"
      />
      <span style={{ color: "var(--db-text-muted, #6b7280)", fontSize: 12 }}>a</span>
      <input
        type="date"
        className={styles.dateInput}
        value={value.to ?? ""}
        min={value.from ?? min ?? undefined}
        max={max ?? undefined}
        onChange={event => onChange({ ...value, to: event.target.value || undefined })}
        title="Hasta"
      />

      <select
        className={styles.dateInput}
        value={value.grain}
        onChange={event => onChange({ ...value, grain: event.target.value as Grain })}
        title="Agrupar por"
      >
        <option value="day">Día</option>
        <option value="week">Semana</option>
        <option value="month">Mes</option>
      </select>
    </div>
  );
}
