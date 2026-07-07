export interface SelectOption {
  label: string;
  value: string;
}

interface SelectWithAllProps {
  label?: string;
  value: string | undefined;
  options: SelectOption[];
  allLabel?: string;
  onChange: (value: string | undefined) => void;
  title?: string;
}

const inputStyle = {
  borderColor: "var(--eyg-border)",
  background: "var(--eyg-card)",
  color: "var(--text-primary)"
} as const;

const ALL_VALUE = "ALL";

// <select> genérico con opción "Todos" siempre presente y primera - el
// value "ALL" nunca debe llegar al SQL como literal (ver
// lib/filter-utils.ts::isAllFilter/normalizeFilterValue, que lo colapsan a
// `undefined` antes de armar cualquier condición WHERE).
export function SelectWithAll({ label, value, options, allLabel = "Todos", onChange, title }: SelectWithAllProps) {
  return (
    <select
      className="rounded border px-2 py-1.5 text-sm"
      style={inputStyle}
      value={value ?? ALL_VALUE}
      title={title ?? label}
      onChange={event => {
        const next = event.target.value;
        onChange(next === ALL_VALUE ? undefined : next);
      }}
    >
      <option value={ALL_VALUE}>{label ? `${label}: ${allLabel}` : allLabel}</option>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
