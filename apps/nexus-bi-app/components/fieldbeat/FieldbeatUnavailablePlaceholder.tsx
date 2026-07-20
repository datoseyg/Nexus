interface FieldbeatUnavailablePlaceholderProps {
  title: string;
  subtitle: string;
  reason: string;
}

// Reproduce el bloque punteado repetido 4 veces en el mockup (evolución,
// tipo de tarea, cruce cliente×máquina, cruce cliente×tipo de tarea) - 2
// consumidores reales o más justifican este componente compartido
// (codebase-design: "un adaptador es hipotético, dos es un seam real").
// Nunca "Próximamente"/"En construcción" - siempre la razón concreta de
// por qué el contrato actual no respalda esta sección.
export function FieldbeatUnavailablePlaceholder({ title, subtitle, reason }: FieldbeatUnavailablePlaceholderProps) {
  return (
    <div className="rounded-[14px] p-4.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {title}
      </div>
      <div className="mb-3 mt-0.5 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
        {subtitle}
      </div>
      <div className="flex items-center gap-3.5 rounded-[10px] border-[1.5px] border-dashed p-5" style={{ borderColor: "var(--nx-border)" }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--nx-text-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17l6-6 4 4 8-9" />
          <path d="M3 21h18" />
        </svg>
        <div role="status">
          <div className="text-[14.5px] font-bold" style={{ color: "var(--nx-text-secondary)" }}>
            Información todavía no disponible
          </div>
          <div className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
            {reason}
          </div>
        </div>
      </div>
    </div>
  );
}
