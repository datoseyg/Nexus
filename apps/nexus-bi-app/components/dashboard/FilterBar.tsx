import styles from "./dashboard.module.css";

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

// Barra de filtros superior, reutilizada por ambos tabs. Un filtro
// deshabilitado (disabled=true) muestra su disabledReason como title
// (tooltip) - nunca se oculta en silencio, ver
// docs/DASHBOARD_VISUAL_STYLE.md.
export function FilterBar({ filters, values, onChange, onClear, extra }: FilterBarProps) {
  return (
    <div className={styles.filterBar}>
      {filters.map(filter => {
        if (filter.type === "select") {
          return (
            <select
              key={filter.key}
              className={`${styles.filterSelect} ${filter.disabled ? styles.filterSelectDisabled : ""}`}
              value={values[filter.key] ?? ""}
              onChange={event => onChange(filter.key, event.target.value)}
              disabled={filter.disabled}
              title={filter.disabled ? filter.disabledReason : undefined}
            >
              <option value="">{filter.disabled ? `${filter.placeholder} (no disponible)` : filter.placeholder}</option>
              {!filter.disabled && filter.options.map(option => (
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
            className={styles.filterInput}
            placeholder={filter.placeholder}
            value={values[filter.key] ?? ""}
            onChange={event => onChange(filter.key, event.target.value)}
          />
        );
      })}

      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClear}>
        Borrar filtros
      </button>

      {extra && (
        <>
          <div className={styles.spacer} />
          {extra}
        </>
      )}
    </div>
  );
}
