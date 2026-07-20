export interface FieldbeatUnavailableSectionCopy {
  key: string;
  title: string;
  subtitle: string;
  reason: string;
}

// ETAPA 5-V - las 4 secciones que el mockup muestra en su posición
// original pero que el contrato actual de 5 queries fijas no respalda.
// Nunca "Próximamente"/"En construcción" - siempre la razón concreta.
// Nunca una cifra copiada del mockup (ej. "11 categorías de tarea
// confirmadas") - ninguna de esas cantidades fue verificada contra un
// contrato real.
export const FIELDBEAT_UNAVAILABLE_SECTIONS: readonly FieldbeatUnavailableSectionCopy[] = [
  {
    key: "evolution",
    title: "¿Cómo evoluciona la actividad?",
    subtitle: "Reportes de terreno por mes calendario",
    reason: "Los resultados que alimentan esta pantalla no incluyen una serie temporal por mes; no es posible construir esta evolución sin ampliar el origen de datos de FieldBeat."
  },
  {
    key: "task_type",
    title: "¿Qué tipos de tarea predominan?",
    subtitle: "Distribución de reportes por tipo de tarea",
    reason: "El campo tipo de tarea no está presente en ninguno de los resultados que alimentan esta pantalla."
  },
  {
    key: "client_equipment_cross",
    title: "¿Cómo se relacionan clientes y máquinas?",
    subtitle: "Cruce de reportes por cliente y equipo",
    reason: "Esta pantalla no cuenta con un cruce de cliente y equipo; los datos disponibles solo permiten rankings independientes por cliente y por equipo."
  },
  {
    key: "client_task_type_cross",
    title: "¿Cómo se distribuye la actividad por cliente y tipo de tarea?",
    subtitle: "Reportes por cliente, separados por tipo de tarea",
    reason: "Esta vista requiere el tipo de tarea por reporte, no disponible en esta iteración."
  }
];
