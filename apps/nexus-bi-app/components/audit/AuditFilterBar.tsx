import { BUTTON_GHOST } from "@/components/ui/interactive";

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
  borderColor: "var(--nx-border)",
  background: "var(--nx-card-bg)",
  color: "var(--nx-text-primary)"
} as const;

// Barra de filtros compartida por las 5 pestañas tabulares de
// /audit/manual-review (cliente, máquina, período, búsqueda textual) + un
// slot `extra` para el filtro específico de cada pestaña ("Tipo de
// problema"/"Estado de calidad", nunca el nombre técnico del enum) - ver
// sección 13 de la corrección de negocio de Auditoría.
export function AuditFilterBar({ clientes, maquinas, values, onChange, onClear, extra, searchPlaceholder }: AuditFilterBarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
      <label className="flex flex-col gap-1 text-xs">
        <span style={{ color: "var(--nx-text-secondary)" }}>Cliente</span>
        <select className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.cliente ?? ""} onChange={event => onChange("cliente", event.target.value)}>
          <option value="">Todos</option>
          {clientes.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span style={{ color: "var(--nx-text-secondary)" }}>Equipo</span>
        <select className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.maquina ?? ""} onChange={event => onChange("maquina", event.target.value)}>
          <option value="">Todos</option>
          {maquinas.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span style={{ color: "var(--nx-text-secondary)" }}>Período desde</span>
        <input type="date" className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.from ?? ""} onChange={event => onChange("from", event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span style={{ color: "var(--nx-text-secondary)" }}>Período hasta</span>
        <input type="date" className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.to ?? ""} onChange={event => onChange("to", event.target.value)} />
      </label>

      {extra}

      <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs">
        <span style={{ color: "var(--nx-text-secondary)" }}>Buscar</span>
        <input
          type="text"
          className="rounded border px-2 py-1.5 text-sm"
          style={inputStyle}
          placeholder={searchPlaceholder ?? "Buscar…"}
          value={values.q ?? ""}
          onChange={event => onChange("q", event.target.value)}
        />
      </label>

      <button
        type="button"
        onClick={onClear}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${BUTTON_GHOST}`}
        style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
      >
        Limpiar filtros
      </button>
    </div>
  );
}
