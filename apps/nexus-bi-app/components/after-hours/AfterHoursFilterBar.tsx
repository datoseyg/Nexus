export interface AfterHoursFilterValues {
  client?: string;
  technician?: string;
  taskType?: string;
  from?: string;
  to?: string;
  confidenceLevel?: string;
  onlyAfterHours?: string;
  onlyLowConfidence?: string;
}

interface AfterHoursFilterBarProps {
  clientes: string[];
  tecnicos: string[];
  tiposTarea: string[];
  values: AfterHoursFilterValues;
  onChange: (key: keyof AfterHoursFilterValues, value: string) => void;
  onClear: () => void;
}

const CONFIDENCE_LEVELS = ["Alta", "Media", "Baja", "Insuficiente"];

const inputStyle = {
  borderColor: "var(--eyg-border)",
  background: "var(--eyg-card)",
  color: "var(--text-primary)"
} as const;

// Barra de filtros de /dashboard/after-hours - mismo look que AuditFilterBar
// pero con el set de campos propio de esta vista (cliente/técnico/tipo de
// tarea/rango de fechas/nivel de confiabilidad/solo-fuera-de-horario/
// solo-baja-confianza). Ver docs/AFTER_HOURS_METRICS.md.
export function AfterHoursFilterBar({ clientes, tecnicos, tiposTarea, values, onChange, onClear }: AfterHoursFilterBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
      <select className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.client ?? ""} onChange={event => onChange("client", event.target.value)}>
        <option value="">Cliente</option>
        {clientes.map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.technician ?? ""} onChange={event => onChange("technician", event.target.value)}>
        <option value="">Técnico</option>
        {tecnicos.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.taskType ?? ""} onChange={event => onChange("taskType", event.target.value)}>
        <option value="">Tipo de tarea</option>
        {tiposTarea.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <input type="date" className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.from ?? ""} onChange={event => onChange("from", event.target.value)} title="Desde" />
      <input type="date" className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={values.to ?? ""} onChange={event => onChange("to", event.target.value)} title="Hasta" />

      <select
        className="rounded border px-2 py-1.5 text-sm"
        style={inputStyle}
        value={values.confidenceLevel ?? ""}
        onChange={event => onChange("confidenceLevel", event.target.value)}
      >
        <option value="">Confiabilidad (todas)</option>
        {CONFIDENCE_LEVELS.map(level => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
        <input
          type="checkbox"
          checked={values.onlyAfterHours === "true"}
          onChange={event => onChange("onlyAfterHours", event.target.checked ? "true" : "")}
        />
        Solo fuera de horario
      </label>

      <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
        <input
          type="checkbox"
          checked={values.onlyLowConfidence === "true"}
          onChange={event => onChange("onlyLowConfidence", event.target.checked ? "true" : "")}
        />
        Solo baja confianza
      </label>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{ borderColor: "var(--eyg-border)", color: "var(--text-secondary)" }}
      >
        Borrar filtros
      </button>
    </div>
  );
}
