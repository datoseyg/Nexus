interface AfterHoursSectionCardProps {
  question: string;
  subtitle: string;
  children: React.ReactNode;
}

// Card "pregunta como título" (ETAPA 6.6D, patrón repetido en todo el
// prototipo: Evolución, distribución temporal, rankings, tipo de tarea,
// confianza) - título en oración (no mayúsculas), subtítulo gris debajo,
// contenido abajo. Distinto del uppercase-label de components/ui/
// ChartCard.tsx (ese es para el patrón "eyebrow" de Dashboard Operacional,
// no para este).
export function AfterHoursSectionCard({ question, subtitle, children }: AfterHoursSectionCardProps) {
  return (
    <div className="rounded-[var(--nx-radius-card)] p-4.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {question}
      </div>
      <div className="mb-3 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
        {subtitle}
      </div>
      {children}
    </div>
  );
}
