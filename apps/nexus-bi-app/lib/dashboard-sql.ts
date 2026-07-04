// origin_location puede venir con más de una bodega separadas por coma
// (ej. "Pañol E&G,Otros (Comente)") - ver docs/DASHBOARD_VISUAL_STYLE.md.
export function splitOriginLocations(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

// Estado del "report_quality_status" -> etiqueta visual del dashboard de
// referencia. Mapeo documentado explícitamente en
// docs/DASHBOARD_VISUAL_STYLE.md - no inventa estados nuevos, reutiliza
// los 6 ya definidos en el pipeline (ver DATA_DICTIONARY.md).
export const ESTADO_GENERAL_LABELS: Record<string, string> = {
  NO_USED_PARTS: "Éxito (Sin Repuestos)",
  OK: "Éxito (Con Repuestos)",
  HAS_PLACEHOLDERS: "Validación Manual",
  REVIEW_REQUIRED: "Validación Manual",
  HAS_UNMATCHED_PARTS: "Error",
  HAS_AMBIGUOUS_PARTS: "Error"
};

export const ESTADO_GENERAL_ORDER = ["Éxito (Sin Repuestos)", "Éxito (Con Repuestos)", "Validación Manual", "Error"];

// Inverso de ESTADO_GENERAL_LABELS: etiqueta visual -> lista de valores
// crudos de report_quality_status. Se usa para expandir el filtro
// "reportQuality" (cross-filter del gráfico Estado General) de vuelta a
// condiciones SQL válidas.
export const ESTADO_GENERAL_REVERSE: Record<string, string[]> = Object.entries(ESTADO_GENERAL_LABELS).reduce<Record<string, string[]>>(
  (map, [raw, label]) => {
    if (!map[label]) map[label] = [];
    map[label].push(raw);
    return map;
  },
  {}
);

// Distribución de estados de TICKETS Zendesk (no confundir con
// task_state de FieldBeat). Los 5 valores reales observados en
// processed.zendesk_tickets.status son: closed, solved, open, new, pending
// (verificado por query directa contra el warehouse) - se agrupan en 3
// categorías de negocio para el gráfico "Distribución de Estados". Ver
// docs/DASHBOARD_VISUAL_STYLE.md.
export const TICKET_ESTADO_ORDER = ["Cerrado", "Abierto", "Pendiente"];
export const TICKET_ESTADO_GROUPS: Record<string, string[]> = {
  Cerrado: ["closed", "solved"],
  Abierto: ["open", "new"]
};
