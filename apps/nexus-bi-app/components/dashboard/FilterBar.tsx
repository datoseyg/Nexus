import { BUTTON_TEXT } from "@/components/ui/interactive";

export interface FilterSelectConfig {
  type: "select";
  key: string;
  placeholder: string;
  options: string[];
  disabled?: boolean;
  disabledReason?: string;
}

export interface FilterInputConfig {
  type: "input";
  key: string;
  placeholder: string;
}

export type FilterConfig = FilterSelectConfig | FilterInputConfig;

interface FilterBarProps {
  filters: FilterConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  extra?: React.ReactNode;
}

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]";

const CONTROL_STYLE: React.CSSProperties = {
  border: "1px solid var(--nx-border)",
  borderRadius: "var(--nx-radius-button)",
  background: "#ffffff",
  color: "var(--nx-text-primary)",
  fontSize: 13,
  minHeight: 44,
  minWidth: 150,
  maxWidth: "100%",
  padding: "0 12px"
};

// Barra de filtros superior, reutilizada por ambos tabs, migrada a
// tokens --nx-*. Un filtro deshabilitado (disabled=true) muestra su
// disabledReason como title (tooltip) - nunca se oculta en silencio.
// Controles con min-height 44px (target táctil) y foco visible heredado
// de globals.css.
export function FilterBar({ filters, values, onChange, onClear, extra }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {filters.map(filter => {
        if (filter.type === "select") {
          return (
            <select
              key={filter.key}
              className={FOCUS_RING}
              style={{
                ...CONTROL_STYLE,
                background: filter.disabled ? "var(--nx-page-bg)" : CONTROL_STYLE.background,
                color: filter.disabled ? "var(--nx-text-muted)" : CONTROL_STYLE.color,
                cursor: filter.disabled ? "not-allowed" : "pointer"
              }}
              value={values[filter.key] ?? ""}
              onChange={event => onChange(filter.key, event.target.value)}
              disabled={filter.disabled}
              title={filter.disabled ? filter.disabledReason : undefined}
            >
              <option value="">{filter.disabled ? `${filter.placeholder} (no disponible)` : filter.placeholder}</option>
              {!filter.disabled &&
                filter.options.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
            </select>
          );
        }

        return (
          <input
            key={filter.key}
            type="text"
            className={FOCUS_RING}
            style={CONTROL_STYLE}
            placeholder={filter.placeholder}
            value={values[filter.key] ?? ""}
            onChange={event => onChange(filter.key, event.target.value)}
          />
        );
      })}

      <button
        type="button"
        className={`ml-auto whitespace-nowrap text-[13px] font-semibold underline ${BUTTON_TEXT}`}
        style={{ color: "var(--nx-accent-indigo)", minHeight: 44, padding: "0 4px" }}
        onClick={onClear}
      >
        Limpiar filtros
      </button>

      {extra}
    </div>
  );
}
