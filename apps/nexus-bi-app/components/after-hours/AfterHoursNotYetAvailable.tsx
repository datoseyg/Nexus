import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";

interface AfterHoursNotYetAvailableProps {
  question: string;
  subtitle: string;
  reason: string;
}

// Bloques del prototipo sin respaldo de API hoy (día de semana/heatmap
// horario, cruce técnico×cliente - ETAPA 6.6D §9). No se inventan datos ni
// se llama al endpoint por fila para armarlos: se documenta la carencia
// como alcance de una futura API, sin tocar ningún endpoint (fuera de
// scope de esta etapa). Layout idéntico al resto de las cards vacías -la
// grilla nunca colapsa ni se reordena por esto.
export function AfterHoursNotYetAvailable({ question, subtitle, reason }: AfterHoursNotYetAvailableProps) {
  return (
    <AfterHoursSectionCard question={question} subtitle={subtitle}>
      <AfterHoursEmptyBlock layout="column" title="Sin datos conectados todavía" description={reason} />
    </AfterHoursSectionCard>
  );
}
