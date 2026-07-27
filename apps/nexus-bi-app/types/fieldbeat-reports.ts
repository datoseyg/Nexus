import type { InconsistencyCode, InconsistencySeverity } from "@/lib/fieldbeat-inconsistency-taxonomy";

export type FieldbeatReportsView = "exceptions" | "all";
export type FieldbeatReportsSortKey = "date" | "severity" | "client" | "technician" | "taskType" | "id";
export type FieldbeatReportsDirection = "asc" | "desc";

export interface FieldbeatReportFinding {
  code: InconsistencyCode;
  severity: InconsistencySeverity;
}

// 1 fila por reporte (nunca por línea de repuesto ni por hallazgo) -
// primaria + secundarias preservadas, para que "Todos los reportes" pueda
// mostrar limpios (primary=null) sin perder las señales de un reporte con
// múltiples hallazgos.
export interface FieldbeatReportRow {
  fieldbeatTaskId: string;
  fecha: string | null;
  cliente: string | null;
  tecnico: string | null;
  equipo: string | null;
  tipoTarea: string | null;
  origen: string | null;
  reportQualityStatus: string | null;
  hasTicketReported: boolean;
  ticketAccessible: boolean | null;
  primary: FieldbeatReportFinding | null;
  findings: FieldbeatReportFinding[];
  /** Aditivo (HOTFIX de integridad de datos FieldBeat, Stage 10) -
   * participantes adicionales (nunca el responsable principal, ya cubierto
   * por `tecnico`) - fuente quality.fieldbeat_report_participants (sql/088). */
  additionalParticipants: string[];
}

export interface FieldbeatReportsResponse {
  rows: FieldbeatReportRow[];
  view: FieldbeatReportsView;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  effectiveRangeFrom: number;
  effectiveRangeTo: number;
  sort: FieldbeatReportsSortKey;
  direction: FieldbeatReportsDirection;
  search: string | null;
}
