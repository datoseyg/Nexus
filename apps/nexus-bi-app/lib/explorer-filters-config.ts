// Tarjeta de filtros del Explorador (sección 6 del encargo de fidelidad
// visual) - declara, por entidad, qué controles de filtro son REALES (con
// datos ya disponibles) - nunca una columna física inventada. Las opciones
// de un <select> vienen de datos reales (lista de clientes ya usada en
// Auditoría, o vocabularios ya cerrados de governance.* como severidad/
// estado/tipo de entidad) - nunca un enum adivinado.
import type { ExplorerEntity } from "@/types/explorer";
import { BANDEJA_SEVERITY_VALUES } from "@/lib/audit-bandeja-url-state";
import { severityBadge, issueStatusBadge } from "@/components/ui/StatusBadge";
import { ENTITY_TYPE_LABELS } from "@/lib/audit-vocabulary";

export type ExplorerFilterKey = "client" | "taskType" | "dateFrom" | "dateTo" | "severity" | "status" | "entityType";

export interface ExplorerFilterOption {
  value: string;
  label: string;
}

export interface ExplorerFilterDef {
  key: ExplorerFilterKey;
  label: string;
  kind: "select" | "date";
  /** Para "select": opciones estáticas (vocabularios ya cerrados) u
   * omitido cuando las opciones se cargan de una fuente real en runtime
   * (ej. lista de clientes vía /api/dashboard/operacional/filters). */
  staticOptions?: ExplorerFilterOption[];
  /** Marca los selects cuyas opciones se completan en runtime desde datos
   * reales ya cargados por el shell (clientes, tipos de tarea reales). */
  dynamicOptionsKey?: "clientes" | "taskTypes";
}

const ISSUE_STATUS_VALUES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;

export const EXPLORER_FILTER_CONFIG: Partial<Record<ExplorerEntity, ExplorerFilterDef[]>> = {
  reports: [
    { key: "client", label: "Cliente", kind: "select", dynamicOptionsKey: "clientes" },
    { key: "taskType", label: "Tipo de tarea", kind: "select", dynamicOptionsKey: "taskTypes" },
    { key: "dateFrom", label: "Desde", kind: "date" },
    { key: "dateTo", label: "Hasta", kind: "date" }
  ],
  issues: [
    {
      key: "severity",
      label: "Severidad",
      kind: "select",
      staticOptions: BANDEJA_SEVERITY_VALUES.map(value => ({ value, label: severityBadge(value).label }))
    },
    {
      key: "status",
      label: "Estado",
      kind: "select",
      staticOptions: ISSUE_STATUS_VALUES.map(value => ({ value, label: issueStatusBadge(value).label }))
    },
    {
      key: "entityType",
      label: "Entidad",
      kind: "select",
      staticOptions: Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({ value, label }))
    }
  ]
};

export function explorerFiltersFor(entity: ExplorerEntity): ExplorerFilterDef[] {
  return EXPLORER_FILTER_CONFIG[entity] ?? [];
}
