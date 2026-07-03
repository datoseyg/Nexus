export interface AuditFilterValues {
  cliente?: string;
  maquina?: string;
  from?: string;
  to?: string;
  q?: string;
}

interface AuditFilterBarProps {
  clientes: string[];
  maquinas: string[];
  values: AuditFilterValues;
  onChange: (key: keyof AuditFilterValues, value: string) => void;
  onClear: () => void;
  extra?: React.ReactNode;
  searchPlaceholder?: string;
}

const inputStyle = {
  borderColor: "var(--eyg-border)",
  background: "var(--eyg-card)",
  color: "var(--text-primary)"
} as const;

// Barra de filtros compartida por las 5 pestañas tabulares de
// /audit/manual-review (cliente, máquina, rango de fechas, búsqueda
// textual) + un slot `extra` para el filtro específico de cada pestaña
// (match_status o report_quality_status) — ver docs/MANUAL_REVIEW_VIEW.md.
export function AuditFilterBar({ clientes, maquinas, values, onChange, onClear, extra, searchPlaceholder }: AuditFilterBarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
      <select
        className="rounded border px-2 py-1.5 text-sm"
        style={inputStyle}
        value={values.cliente ?? ""}
        onChange={event => onChange("cliente", event.target.value)}
      >
        <option value="">Cliente</option>
        {clientes.map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        className="rounded border px-2 py-1.5 text-sm"
        style={inputStyle}
        value={values.maquina ?? ""}
        onChange={event => onChange("maquina", event.target.value)}
      >
        <option value="">Máquina</option>
        {maquinas.map(m => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <input
        type="date"
        className="rounded border px-2 py-1.5 text-sm"
        style={inputStyle}
        value={values.from ?? ""}
        onChange={event => onChange("from", event.target.value)}
        title="Desde"
      />
      <input
        type="date"
        className="rounded border px-2 py-1.5 text-sm"
        style={inputStyle}
        value={values.to ?? ""}
        onChange={event => onChange("to", event.target.value)}
        title="Hasta"
      />

      {extra}

      <input
        type="text"
        className="min-w-[180px] flex-1 rounded border px-2 py-1.5 text-sm"
        style={inputStyle}
        placeholder={searchPlaceholder ?? "Buscar…"}
        value={values.q ?? ""}
        onChange={event => onChange("q", event.target.value)}
      />

      <button
        type="button"
        onClick={onClear}
        className="rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{ borderColor: "var(--eyg-border)", color: "var(--text-secondary)" }}
      >
        Borrar filtros
      </button>
    </div>
  );
}
