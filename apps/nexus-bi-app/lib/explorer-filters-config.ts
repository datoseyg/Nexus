// Tarjeta de filtros del Explorador (sección 6 del encargo de fidelidad
// visual) - declara, por entidad, qué controles de filtro son REALES (con
// datos ya disponibles) - nunca una columna física inventada. Las opciones
// de un <select> vienen de datos reales (lista de clientes ya usada en
// Auditoría, o vocabularios ya cerrados de governance.*/config.* como
// severidad/estado/tipo de entidad/estado de contrato) - nunca un enum
// adivinado. Filtros deliberadamente NO implementados (documentados en el
// reporte final, no acá): "estado contractual" de Clientes (sin columna real
// a ese nivel), "part_usage_status"/"requires_review" de Repuestos (no
// existen como columnas de repuestos en ningún lado del código).
import type { ExplorerEntity } from "@/types/explorer";
import { BANDEJA_SEVERITY_VALUES, BANDEJA_VERIFICATION_VALUES } from "@/lib/audit-bandeja-url-state";
import { severityBadge, issueStatusBadge } from "@/components/ui/StatusBadge";
import { ENTITY_TYPE_LABELS, matchStatusFinding, verificationOutcomeLabel, verificationProcessingStatusLabel } from "@/lib/audit-vocabulary";
import { CONTRACT_STATUS_LABELS, SPA_TIER_LABELS, PARTS_COVERAGE_LABELS, CONTRACT_MATCH_STATUS_LABELS } from "@/lib/contracts-vocabulary";

export type ExplorerFilterKey =
  | "client"
  | "taskType"
  | "dateFrom"
  | "dateTo"
  | "severity"
  | "status"
  | "entityType"
  | "detection"
  | "ruleCode"
  | "verification"
  | "city"
  | "commune"
  | "hasEquipment"
  | "hasReports"
  | "hasActiveIssues"
  | "equipmentType"
  | "model"
  | "linkStatus"
  | "contractStatus"
  | "matchStatus"
  | "verified"
  | "hasPrimaryReports"
  | "hasParticipantReports"
  | "equipment"
  | "technician"
  | "hasTicket"
  | "hasParts"
  | "qualityStatus"
  | "ticketStatus"
  | "hasDolibarrProduct"
  | "saleStatus"
  | "purchaseStatus"
  | "hasUsageInReports"
  | "spaTier"
  | "serviceWeekday"
  | "serviceWeekend"
  | "partsCoverage"
  | "warrantyStatus";

export interface ExplorerFilterOption {
  value: string;
  label: string;
}

export type ExplorerDynamicOptionsKey =
  | "clientes"
  | "contractClients"
  | "taskTypes"
  | "equipmentTypes"
  | "ruleCodes"
  | "cities"
  | "communes"
  | "models"
  | "equipmentInternalIds"
  | "technicianNames"
  | "ticketStatuses"
  | "saleStatuses"
  | "purchaseStatuses";

export interface ExplorerFilterDef {
  key: ExplorerFilterKey;
  label: string;
  kind: "select" | "date" | "boolean";
  /** Para "select": opciones estáticas (vocabularios ya cerrados) u
   * omitido cuando las opciones se cargan de una fuente real en runtime
   * (ej. lista de clientes, o "familia" de Equipos vía facet DISTINCT). */
  staticOptions?: ExplorerFilterOption[];
  /** Marca los selects cuyas opciones se completan en runtime desde datos
   * reales - clientes/tipos de tarea (shell), o vía GET
   * /api/explorer/[entity]/facets (equipmentTypes, ruleCodes). */
  dynamicOptionsKey?: ExplorerDynamicOptionsKey;
}

const ISSUE_STATUS_VALUES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
const DETECTION_OPTIONS: ExplorerFilterOption[] = [
  { value: "current", label: "Actuales" },
  { value: "all", label: "Todas" }
];
const YES_NO_OPTIONS: ExplorerFilterOption[] = [
  { value: "true", label: "Sí" },
  { value: "false", label: "No" }
];
const PARTS_MATCH_STATUS_VALUES = ["MATCHED", "NO_MATCH", "AMBIGUOUS_MATCH", "PLACEHOLDER_VALUE", "NO_PART_USED"] as const;
const REPORT_QUALITY_STATUS_VALUES = ["OK", "HAS_PLACEHOLDERS", "HAS_UNMATCHED_PARTS", "HAS_AMBIGUOUS_PARTS", "REVIEW_REQUIRED", "NO_USED_PARTS"] as const;
const REPORT_QUALITY_STATUS_LABELS: Record<(typeof REPORT_QUALITY_STATUS_VALUES)[number], string> = {
  OK: "Sin observaciones",
  HAS_PLACEHOLDERS: "Con valores incompletos",
  HAS_UNMATCHED_PARTS: "Con repuestos sin identificar",
  HAS_AMBIGUOUS_PARTS: "Con coincidencias ambiguas",
  REVIEW_REQUIRED: "Requiere revisión",
  NO_USED_PARTS: "Sin repuestos declarados"
};
const CONTRACT_EQUIPMENT_MATCH_STATUS_VALUES = ["MATCHED", "UNMATCHED", "AMBIGUOUS"] as const;
const WARRANTY_STATUS_OPTIONS: ExplorerFilterOption[] = [
  { value: "active", label: "Vigente" },
  { value: "expired", label: "Vencida" }
];

export const EXPLORER_FILTER_CONFIG: Partial<Record<ExplorerEntity, ExplorerFilterDef[]>> = {
  clients: [
    { key: "city", label: "Ciudad", kind: "select", dynamicOptionsKey: "cities" },
    { key: "commune", label: "Comuna", kind: "select", dynamicOptionsKey: "communes" },
    { key: "hasEquipment", label: "Con equipos", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasReports", label: "Con reportes", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasActiveIssues", label: "Con incidencias activas", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  equipment: [
    { key: "client", label: "Cliente", kind: "select", dynamicOptionsKey: "clientes" },
    { key: "equipmentType", label: "Familia", kind: "select", dynamicOptionsKey: "equipmentTypes" },
    { key: "model", label: "Modelo", kind: "select", dynamicOptionsKey: "models" },
    {
      key: "contractStatus",
      label: "Estado contractual",
      kind: "select",
      staticOptions: Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => ({ value, label }))
    },
    {
      key: "linkStatus",
      label: "Estado de vínculo",
      kind: "select",
      staticOptions: CONTRACT_EQUIPMENT_MATCH_STATUS_VALUES.map(value => ({ value, label: CONTRACT_MATCH_STATUS_LABELS[value] }))
    },
    { key: "hasReports", label: "Con reportes", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasActiveIssues", label: "Con incidencias activas", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  technicians: [
    { key: "verified", label: "Identidad verificada", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasPrimaryReports", label: "Con reportes como responsable", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasParticipantReports", label: "Con participación adicional", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  reports: [
    { key: "client", label: "Cliente", kind: "select", dynamicOptionsKey: "clientes" },
    { key: "taskType", label: "Tipo de tarea", kind: "select", dynamicOptionsKey: "taskTypes" },
    { key: "dateFrom", label: "Desde", kind: "date" },
    { key: "dateTo", label: "Hasta", kind: "date" },
    { key: "equipment", label: "Equipo", kind: "select", dynamicOptionsKey: "equipmentInternalIds" },
    { key: "technician", label: "Técnico", kind: "select", dynamicOptionsKey: "technicianNames" },
    { key: "hasTicket", label: "Con ticket", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasParts", label: "Con repuestos", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    {
      key: "qualityStatus",
      label: "Estado de calidad",
      kind: "select",
      staticOptions: REPORT_QUALITY_STATUS_VALUES.map(value => ({ value, label: REPORT_QUALITY_STATUS_LABELS[value] }))
    },
    { key: "hasActiveIssues", label: "Con incidencias activas", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  tickets: [
    { key: "ticketStatus", label: "Estado Zendesk", kind: "select", dynamicOptionsKey: "ticketStatuses" },
    { key: "dateFrom", label: "Desde", kind: "date" },
    { key: "dateTo", label: "Hasta", kind: "date" },
    { key: "hasReports", label: "Con reporte FieldBeat", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "hasActiveIssues", label: "Con incidencias activas", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  parts: [
    {
      key: "matchStatus",
      label: "Estado de coincidencia",
      kind: "select",
      staticOptions: PARTS_MATCH_STATUS_VALUES.map(value => ({ value, label: matchStatusFinding(value) }))
    },
    { key: "hasDolibarrProduct", label: "Con producto Dolibarr", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "client", label: "Cliente", kind: "select", dynamicOptionsKey: "clientes" },
    { key: "dateFrom", label: "Desde", kind: "date" },
    { key: "dateTo", label: "Hasta", kind: "date" },
    { key: "hasActiveIssues", label: "Con incidencias activas", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  products: [
    { key: "saleStatus", label: "Estado de venta (código Dolibarr)", kind: "select", dynamicOptionsKey: "saleStatuses" },
    { key: "purchaseStatus", label: "Estado de compra (código Dolibarr)", kind: "select", dynamicOptionsKey: "purchaseStatuses" },
    { key: "hasUsageInReports", label: "Con uso en reportes", kind: "boolean", staticOptions: YES_NO_OPTIONS }
  ],
  contracts: [
    // "contractClients" (Bloque 2 NEXUS V3), NUNCA "clientes" acá -
    // "clientes" resuelve identidad de FieldBeat (processed.fieldbeat_clients),
    // un vocabulario de cliente distinto y no interoperable con el de la
    // planilla de contratos (config.contract_equipment_versions) - usar
    // "clientes" en Contratos era la causa raíz del filtro Cliente
    // devolviendo 0 resultados (facet y filtro leían dos identidades
    // distintas). Ver fetchContractClientOptions()/contractsFilterConditions
    // en lib/explorer-sql.ts.
    { key: "client", label: "Cliente", kind: "select", dynamicOptionsKey: "contractClients" },
    {
      key: "contractStatus",
      label: "Estado de contrato",
      kind: "select",
      staticOptions: Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => ({ value, label }))
    },
    { key: "spaTier", label: "Plan SPA", kind: "select", staticOptions: Object.entries(SPA_TIER_LABELS).map(([value, label]) => ({ value, label })) },
    { key: "serviceWeekday", label: "Servicio en semana", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    { key: "serviceWeekend", label: "Servicio en fin de semana", kind: "boolean", staticOptions: YES_NO_OPTIONS },
    {
      key: "matchStatus",
      label: "Estado de vínculo",
      kind: "select",
      staticOptions: CONTRACT_EQUIPMENT_MATCH_STATUS_VALUES.map(value => ({ value, label: CONTRACT_MATCH_STATUS_LABELS[value] }))
    },
    { key: "warrantyStatus", label: "Garantía", kind: "select", staticOptions: WARRANTY_STATUS_OPTIONS },
    {
      key: "partsCoverage",
      label: "Cobertura de repuestos",
      kind: "select",
      staticOptions: Object.entries(PARTS_COVERAGE_LABELS).map(([value, label]) => ({ value, label }))
    }
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
    },
    { key: "detection", label: "Detección", kind: "select", staticOptions: DETECTION_OPTIONS },
    { key: "ruleCode", label: "Regla", kind: "select", dynamicOptionsKey: "ruleCodes" },
    { key: "dateFrom", label: "Desde", kind: "date" },
    { key: "dateTo", label: "Hasta", kind: "date" },
    {
      key: "verification",
      label: "Verificación",
      kind: "select",
      staticOptions: BANDEJA_VERIFICATION_VALUES.map(value => ({
        value,
        label: value === "pending" || value === "dead_letter" ? verificationProcessingStatusLabel(value === "pending" ? "PENDING" : "DEAD_LETTERED") : value === "none" ? "Sin verificación" : verificationOutcomeLabel(value === "still_detected" ? "STILL_DETECTED" : "PASSED")
      }))
    }
  ]
};

export function explorerFiltersFor(entity: ExplorerEntity): ExplorerFilterDef[] {
  return EXPLORER_FILTER_CONFIG[entity] ?? [];
}
