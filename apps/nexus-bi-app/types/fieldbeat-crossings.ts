// Contrato de GET /api/dashboard/fieldbeat/crossings (Phase 3 §9). 6 cruces
// orientados a problemas, en el orden de prioridad aprobado - nunca el
// cruce operacional cliente x equipo (ese fue eliminado, ver §11).

export const CROSSING_TYPES = [
  "task_type_missing_field",
  "technician_completeness",
  "client_inconsistency_type",
  "technician_inconsistency_type",
  "equipment_problem",
  "origin_quality"
] as const;

export type CrossingType = (typeof CROSSING_TYPES)[number];

export const CROSSING_LABELS: Record<CrossingType, { row: string; col: string; title: string }> = {
  task_type_missing_field: { row: "Tipo de tarea", col: "Campo faltante", title: "Tipo de tarea × campo faltante" },
  technician_completeness: { row: "Técnico", col: "Completitud", title: "Técnico × completitud" },
  client_inconsistency_type: { row: "Cliente", col: "Tipo de inconsistencia", title: "Cliente × tipo de inconsistencia" },
  technician_inconsistency_type: { row: "Técnico", col: "Tipo de inconsistencia", title: "Técnico × tipo de inconsistencia" },
  equipment_problem: { row: "Equipo", col: "Problema", title: "Equipo × problema" },
  origin_quality: { row: "Origen", col: "Calidad del reporte", title: "Origen × calidad" }
};

export interface FieldbeatCrossingCell {
  row: string;
  col: string;
  count: number;
}

// Phase 3 reapertura §5 - metadata explícita de límites (antes solo
// `truncated`, sin distinguir filas de columnas ni decir cuántas había en
// total). rows.length/cols.length YA son shownRows/shownCols - totalRows/
// totalCols son el dato nuevo (cardinalidad real antes de agrupar en
// "Otros"/"Otras").
export interface FieldbeatCrossingResponse {
  type: CrossingType;
  rowDimensionLabel: string;
  colDimensionLabel: string;
  rows: string[];
  cols: string[];
  cells: FieldbeatCrossingCell[];
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  totalRows: number;
  totalCols: number;
  shownRows: number;
  shownCols: number;
  /** true si se agruparon filas y/o columnas de baja frecuencia bajo "Otros"/"Otras". */
  aggregated: boolean;
  generatedAt: string;
  filtersApplied: Record<string, string>;
}
