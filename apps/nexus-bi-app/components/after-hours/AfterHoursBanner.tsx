interface AfterHoursBannerProps {
  fallbackTasks: number;
  calculableTasks: number;
}

// Banner informativo obligatorio (ETAPA 6.6D §6) - conserva el tratamiento
// visual amarillo del prototipo (tokens --nx-warning-*, ya extraídos de
// este mismo mockup en globals.css), pero corrige el contenido: el
// calendario nacional de feriados quedó con cobertura completa CL
// 2018-2026 en ETAPA 6.6B1, así que ya no se afirma que "la configuración
// de horarios y feriados está incompleta" (eso era cierto en el mockup
// original, dejó de serlo). El texto explica la arquitectura real
// (contrato vigente -> horario global de respaldo) en vez de una
// advertencia genérica de "cálculo estimado".
export function AfterHoursBanner({ fallbackTasks, calculableTasks }: AfterHoursBannerProps) {
  return (
    <div
      className="mb-4.5 rounded-xl border-[1.5px] px-4 py-3.5"
      style={{ background: "var(--nx-warning-bg)", borderColor: "var(--nx-warning-border)" }}
    >
      <div className="text-sm font-bold" style={{ color: "var(--nx-warning-fg)" }}>
        Este análisis es operacional.
      </div>
      <div className="mt-0.5 text-[13.5px]" style={{ color: "var(--nx-warning-fg)" }}>
        La base del cálculo puede provenir de un contrato vigente o del horario global cuando el intento contractual no
        puede resolverse. No representa por sí solo horas extraordinarias, incumplimiento laboral ni infracción.
      </div>
      {calculableTasks > 0 && fallbackTasks > 0 && (
        <div className="mt-1.5 text-[13px]" style={{ color: "var(--nx-warning-fg)" }}>
          {fallbackTasks.toLocaleString("es-CL")} de {calculableTasks.toLocaleString("es-CL")} tareas calculables usaron
          el horario global de respaldo porque el intento con el contrato vigente no pudo resolverse.
        </div>
      )}
    </div>
  );
}
