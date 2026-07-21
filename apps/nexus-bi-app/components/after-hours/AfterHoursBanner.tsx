interface AfterHoursBannerProps {
  fallbackTasks: number;
  calculableTasks: number;
  totalTasks: number;
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
export function AfterHoursBanner({ fallbackTasks, calculableTasks, totalTasks }: AfterHoursBannerProps) {
  // Caso distinto de "0 tareas fuera de horario": acá SÍ hay tareas, pero
  // ninguna pudo calcularse (pipeline de contratos/horario global sin
  // correr, o sin datos de entrada) - sin este bloque, un 0 en todos los
  // KPIs es indistinguible de "no hubo trabajo fuera de jornada", cuando en
  // realidad no se pudo calcular nada.
  const allNotCalculable = totalTasks > 0 && calculableTasks === 0;

  return (
    <div
      className="mb-4.5 rounded-xl border-[1.5px] px-4 py-3.5"
      style={{
        // Mismo tono "error" que AfterHoursEmptyBlock (#c0392b / #fdecea):
        // no existe un token --nx-danger-bg/-border, solo --nx-danger-fg.
        background: allNotCalculable ? "#fdecea" : "var(--nx-warning-bg)",
        borderColor: allNotCalculable ? "#f1a9a0" : "var(--nx-warning-border)"
      }}
    >
      {allNotCalculable ? (
        <>
          <div className="text-sm font-bold" style={{ color: "var(--nx-danger-fg)" }}>
            No se pudo calcular ninguna de las {totalTasks.toLocaleString("es-CL")} tareas analizadas.
          </div>
          <div className="mt-0.5 text-[13.5px]" style={{ color: "var(--nx-danger-fg)" }}>
            Los KPIs en 0 de esta pantalla no significan que no hubo trabajo fuera de horario: significan que el
            pipeline de resolución contractual y horario global todavía no se ejecutó (o no tiene datos de entrada)
            sobre este conjunto de tareas. Ejecuta el builder de horas laborales antes de interpretar estos números.
          </div>
        </>
      ) : (
        <>
          <div className="text-sm font-bold" style={{ color: "var(--nx-warning-fg)" }}>
            Este análisis es operacional.
          </div>
          <div className="mt-0.5 text-[13.5px]" style={{ color: "var(--nx-warning-fg)" }}>
            La base del cálculo puede provenir de un contrato vigente o del horario global cuando el intento
            contractual no puede resolverse. No representa por sí solo horas extraordinarias, incumplimiento laboral
            ni infracción.
          </div>
          {calculableTasks > 0 && fallbackTasks > 0 && (
            <div className="mt-1.5 text-[13px]" style={{ color: "var(--nx-warning-fg)" }}>
              {fallbackTasks.toLocaleString("es-CL")} de {calculableTasks.toLocaleString("es-CL")} tareas calculables
              usaron el horario global de respaldo porque el intento con el contrato vigente no pudo resolverse.
            </div>
          )}
        </>
      )}
    </div>
  );
}
