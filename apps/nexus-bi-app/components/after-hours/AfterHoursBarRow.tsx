"use client";

import { barWidthPct } from "@/lib/after-hours-bar-list-view";

interface AfterHoursBarRowProps {
  label: string;
  ariaLabel: string;
  value: number;
  maxValue: number;
  valueLabel: string;
  selected?: boolean;
  onClick?: () => void;
}

// Fila de bar-list accesible (ETAPA 6.6D) - reemplaza las barras SVG de
// Recharts (sin foco de teclado ni click-to-filter posible de forma
// nativa) por un <button> real: label + barra proporcional en CSS + valor,
// con aria-label descriptivo y aria-pressed cuando es seleccionable.
// Reutilizada por AfterHoursRankingCard (técnico/cliente/tipo de tarea),
// AfterHoursWeekdayChart y AfterHoursTechnicianClientCard - un solo
// building block, sin duplicar el markup 3 veces.
export function AfterHoursBarRow({ label, ariaLabel, value, maxValue, valueLabel, selected = false, onClick }: AfterHoursBarRowProps) {
  const pct = barWidthPct(value, maxValue);
  const interactive = Boolean(onClick);

  const content = (
    <>
      <span className="w-[45%] shrink-0 truncate text-left text-[13px]" style={{ color: "var(--nx-text-secondary)" }} title={label}>
        {label}
      </span>
      <span className="relative h-4 flex-1 overflow-hidden rounded" style={{ background: "var(--nx-page-bg)" }}>
        <span
          className="block h-full rounded"
          style={{ width: `${pct}%`, background: selected ? "var(--nx-accent-indigo-hover)" : "var(--nx-accent-indigo)" }}
        />
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
        {valueLabel}
      </span>
    </>
  );

  const rowClassName = "flex w-full items-center gap-2 rounded px-1 py-1";

  if (!interactive) {
    return (
      <div className={rowClassName} aria-label={ariaLabel}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={`${rowClassName} cursor-pointer text-left transition-colors hover:bg-[var(--nx-page-bg)] focus-visible:outline focus-visible:outline-[var(--nx-focus-ring-width)] focus-visible:outline-offset-[var(--nx-focus-ring-offset)] focus-visible:outline-[var(--nx-focus-ring-color)]`}
      style={selected ? { background: "var(--nx-page-bg)" } : undefined}
    >
      {content}
    </button>
  );
}
