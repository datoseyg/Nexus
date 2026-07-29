// Configuración de presentación del Explorador semántico - solo metadata de
// columnas/campos (nunca lógica de consulta, eso vive en explorer-sql.ts,
// server-only). Un componente de tabla y un componente de drawer genéricos,
// configurados por entidad - NUNCA 9 componentes de tabla/drawer separados
// (B20: "reutilizar, no reinventar").
import type { ExplorerEntity } from "@/types/explorer";
import { severityBadge, issueStatusBadge } from "@/components/ui/StatusBadge";
import { entityTypeLabel, evidenceTypeLabel, verificationProcessingStatusLabel, verificationOutcomeLabel } from "@/lib/audit-vocabulary";

export interface ExplorerColumn {
  key: string;
  header: string;
  format?: (value: unknown, row: Record<string, unknown>) => string;
  /** Columna ocultable desde "Columnas visibles" (barra de herramientas de
   * tabla) - solo alterna columnas YA allowlisted acá, nunca revela un
   * campo nuevo (B21). Sin esta marca, la columna es obligatoria. */
  optional?: boolean;
}

export interface ExplorerEntityConfig {
  label: string;
  singularLabel: string;
  /** Descripción de negocio de una línea - tarjeta de resumen (sección 5),
   * nunca el nombre de schema.tabla física (eso vive aparte en
   * ENTITY_IDENTITY.resolutionNote, types/explorer.ts). */
  description: string;
  listColumns: ExplorerColumn[];
  /** Clave de la fila que se usa como key/identificador para pedir el
   * detalle (B46: nunca se asume id/pk genérico). */
  detailKeyColumn: string;
  detailFields: ExplorerColumn[];
  relatedSections: Array<{
    key: string;
    label: string;
    columns: ExplorerColumn[];
    /** "Ver los N X de este Y" (sección 11) - navega al Explorador con un
     * filtro real ya soportado por esa entidad (lib/explorer-filters-config.ts),
     * nunca un link a un filtro que no filtra de verdad. Omitido cuando la
     * entidad relacionada todavía no tiene ese filtro implementado. */
    viewAllLink?: {
      entity: ExplorerEntity;
      buildFilters: (summary: Record<string, unknown>) => Record<string, string>;
      countField: string;
    };
  }>;
  /** true cuando el detalle vive en un drawer canónico externo (Reportes -
   * FieldbeatReportDetailDrawer) - el Explorador nunca abre su propio
   * drawer de detalle para esta entidad. */
  usesExternalDrawer?: boolean;
}

function formatBool(value: unknown): string {
  return value === true ? "Sí" : value === false ? "No" : "-";
}

function formatDate(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "-";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

// governance.issues.resolution_type (Gate B, B1/B44) - solo se llena cuando
// status ya es RESOLVED/DISMISSED, por eso "-" es un valor real y esperado
// (incidencia todavía abierta/en revisión), no un dato faltante.
function formatResolutionType(value: unknown): string {
  if (value === "VERIFIED") return "Verificada por la regla";
  if (value === "DISMISSED") return "Descartada manualmente";
  return "-";
}

// governance.verification_requests_current (última verificación por
// incidencia, B90) - "-" es un valor real y esperado cuando la incidencia
// nunca tuvo una corrección que verificar, no un dato faltante.
function formatVerification(_value: unknown, row: Record<string, unknown>): string {
  const status = row.verification_processing_status as string | null;
  const outcome = row.verification_outcome as string | null;
  if (!status) return "-";
  if (outcome === "PASSED") return verificationOutcomeLabel("PASSED");
  if (outcome === "STILL_DETECTED") return verificationOutcomeLabel("STILL_DETECTED");
  if (status === "DEAD_LETTERED") return verificationProcessingStatusLabel("DEAD_LETTERED");
  return verificationProcessingStatusLabel(status);
}

export const EXPLORER_ENTITY_CONFIG: Record<ExplorerEntity, ExplorerEntityConfig> = {
  clients: {
    label: "Clientes",
    singularLabel: "Cliente",
    description: "Clientes de servicio FieldBeat - volumen de reportes, tickets y repuestos por cliente.",
    listColumns: [
      { key: "client_name", header: "Cliente" },
      { key: "city", header: "Ubicación", format: (value, row) => [value, row.commune].filter(Boolean).join(" - ") || "-" },
      { key: "report_count", header: "Reportes" },
      { key: "ticket_count", header: "Tickets", optional: true },
      { key: "active_issue_count", header: "Incidencias activas" }
    ],
    detailKeyColumn: "client_key",
    detailFields: [
      { key: "client_name", header: "Cliente" },
      { key: "city", header: "Ciudad" },
      { key: "commune", header: "Comuna" },
      { key: "country", header: "País" },
      { key: "address_raw", header: "Dirección" },
      { key: "report_count", header: "Reportes" },
      { key: "ticket_count", header: "Tickets" },
      { key: "used_parts_count", header: "Repuestos usados" }
    ],
    relatedSections: [
      { key: "equipment", label: "Equipos", columns: [{ key: "internal_id", header: "Equipo" }, { key: "equipment_type", header: "Tipo" }] },
      {
        key: "recentReports",
        label: "Reportes recientes",
        columns: [
          { key: "fieldbeat_task_id", header: "Reporte" },
          { key: "fieldbeat_task_date", header: "Fecha", format: formatDate },
          { key: "task_type", header: "Tipo" }
        ],
        viewAllLink: {
          entity: "reports",
          buildFilters: summary => ({ client: String(summary.client_name ?? "") }),
          countField: "report_count"
        }
      }
    ]
  },
  equipment: {
    label: "Equipos",
    singularLabel: "Equipo",
    description: "Equipos con identificador estructurado y su historial de reportes.",
    listColumns: [
      { key: "internal_id", header: "Equipo" },
      { key: "client_name", header: "Cliente" },
      { key: "equipment_type", header: "Tipo", optional: true },
      { key: "report_count", header: "Reportes" },
      { key: "active_issue_count", header: "Incidencias activas" }
    ],
    detailKeyColumn: "equipment_key",
    detailFields: [
      { key: "internal_id", header: "Equipo" },
      { key: "equipment_type", header: "Tipo" },
      { key: "client_name", header: "Cliente" },
      { key: "equipment_model", header: "Modelo (contrato)" },
      { key: "serial_number", header: "N° de serie (contrato)" },
      { key: "contract_status_code", header: "Estado de contrato" },
      { key: "warranty_end_date", header: "Fin de garantía", format: formatDate },
      { key: "report_count", header: "Reportes" }
    ],
    relatedSections: [
      {
        key: "recentReports",
        label: "Reportes recientes",
        columns: [
          { key: "fieldbeat_task_id", header: "Reporte" },
          { key: "fieldbeat_task_date", header: "Fecha", format: formatDate },
          { key: "client_name", header: "Cliente" }
        ]
      }
    ]
  },
  technicians: {
    label: "Técnicos",
    singularLabel: "Técnico",
    description: "Identidad de técnicos resuelta a partir de reportes de campo.",
    listColumns: [
      { key: "display_name", header: "Nombre" },
      { key: "is_manually_verified", header: "Identidad verificada", format: formatBool },
      { key: "primary_report_count", header: "Reportes (responsable)" },
      { key: "participant_report_count", header: "Reportes (participante)", optional: true }
    ],
    detailKeyColumn: "normalized_name",
    detailFields: [
      { key: "display_name", header: "Nombre" },
      { key: "is_manually_verified", header: "Identidad verificada", format: formatBool },
      { key: "primary_report_count", header: "Reportes (responsable)" },
      { key: "participant_report_count", header: "Reportes (participante)" }
    ],
    relatedSections: [
      {
        key: "sourceRepresentations",
        label: "Representaciones de origen",
        columns: [
          { key: "source_type", header: "Origen" },
          { key: "raw_name", header: "Valor crudo" }
        ]
      },
      {
        key: "recentReports",
        label: "Reportes recientes",
        columns: [
          { key: "fieldbeat_task_id", header: "Reporte" },
          { key: "role", header: "Rol" },
          { key: "fieldbeat_task_date", header: "Fecha", format: formatDate },
          { key: "client_name", header: "Cliente" }
        ]
      }
    ]
  },
  reports: {
    label: "Reportes",
    singularLabel: "Reporte",
    description: "Reportes de servicio FieldBeat, con calidad de datos y vínculos a Dolibarr/Zendesk.",
    listColumns: [
      { key: "fieldbeat_task_date", header: "Fecha", format: formatDate },
      { key: "fieldbeat_task_id", header: "Reporte" },
      { key: "client_name", header: "Cliente" },
      { key: "equipment_internal_ids", header: "Equipo(s)" },
      { key: "task_type", header: "Tipo", optional: true },
      { key: "linked_zendesk_ticket_id", header: "Ticket", optional: true },
      { key: "used_parts_count", header: "Repuestos", optional: true },
      { key: "active_issue_count", header: "Incidencias activas" }
    ],
    detailKeyColumn: "fieldbeat_task_id",
    detailFields: [],
    relatedSections: [],
    usesExternalDrawer: true
  },
  tickets: {
    label: "Tickets",
    singularLabel: "Ticket",
    description: "Tickets de soporte Zendesk vinculados a reportes de campo.",
    listColumns: [
      { key: "zendesk_ticket_id", header: "Ticket" },
      { key: "title", header: "Asunto" },
      { key: "status", header: "Estado" },
      { key: "created_at", header: "Fecha", format: formatDate, optional: true },
      { key: "linked_report_count", header: "Reportes vinculados" },
      { key: "active_issue_count", header: "Incidencias activas" }
    ],
    detailKeyColumn: "zendesk_ticket_id",
    detailFields: [
      { key: "ticketId", header: "Ticket" },
      { key: "title", header: "Asunto" },
      { key: "status", header: "Estado" },
      { key: "date", header: "Fecha", format: formatDate },
      { key: "clientName", header: "Cliente" },
      { key: "linkedReportCount", header: "Reportes vinculados" }
    ],
    relatedSections: [
      {
        key: "linkedReports",
        label: "Reportes vinculados",
        columns: [
          { key: "fieldbeatTaskId", header: "Reporte" },
          { key: "date", header: "Fecha", format: formatDate },
          { key: "clientName", header: "Cliente" }
        ]
      }
    ]
  },
  parts: {
    label: "Repuestos declarados",
    singularLabel: "Repuesto",
    description: "Repuestos declarados en reportes, con su identidad resuelta contra el catálogo Dolibarr.",
    listColumns: [
      { key: "dolibarr_ref", header: "SKU", format: value => (value ? String(value) : "Sin match de catálogo") },
      { key: "part_name", header: "Nombre" },
      { key: "raw_part_identifier", header: "Identificador crudo", optional: true },
      { key: "quantity_consumed", header: "Cantidad consumida" },
      { key: "report_count", header: "Reportes" },
      { key: "active_issue_count", header: "Incidencias activas" }
    ],
    detailKeyColumn: "part_key",
    detailFields: [
      { key: "sku", header: "SKU" },
      { key: "partName", header: "Nombre" },
      { key: "rawIdentifier", header: "Identificador crudo" },
      { key: "quantityConsumed", header: "Cantidad consumida" },
      { key: "reportCount", header: "Reportes" },
      { key: "clientCount", header: "Clientes" }
    ],
    relatedSections: [
      {
        key: "recentUsages",
        label: "Usos recientes",
        columns: [
          { key: "fieldbeat_task_id", header: "Reporte" },
          { key: "fieldbeat_task_date", header: "Fecha", format: formatDate },
          { key: "client_name", header: "Cliente" }
        ]
      }
    ]
  },
  products: {
    label: "Productos de catálogo",
    singularLabel: "Producto",
    description: "Catálogo de productos Dolibarr.",
    listColumns: [
      { key: "ref", header: "Ref." },
      { key: "label", header: "Nombre" },
      { key: "status", header: "Estado", optional: true }
    ],
    detailKeyColumn: "ref",
    detailFields: [
      { key: "ref", header: "Ref." },
      { key: "label", header: "Nombre" },
      { key: "status", header: "Estado" },
      { key: "status_buy", header: "Estado de compra" },
      { key: "price", header: "Precio de venta" },
      { key: "date_creation", header: "Creado", format: formatDate }
    ],
    relatedSections: [
      {
        key: "recentUsages",
        label: "Usos recientes",
        columns: [
          { key: "fieldbeat_task_id", header: "Reporte" },
          { key: "fieldbeat_task_date", header: "Fecha", format: formatDate },
          { key: "client_name", header: "Cliente" }
        ]
      }
    ]
  },
  contracts: {
    label: "Contratos",
    singularLabel: "Contrato",
    description: "Contratos de servicio vigentes por equipo.",
    listColumns: [
      { key: "client_name_canonical", header: "Cliente" },
      { key: "equipment_model", header: "Equipo" },
      { key: "contract_status_code", header: "Estado" },
      { key: "spa_tier_code", header: "Nivel SPA", optional: true },
      { key: "serial_number", header: "N° de serie", optional: true },
      { key: "match_status", header: "Match FieldBeat", optional: true }
    ],
    detailKeyColumn: "equipment_key",
    detailFields: [
      { key: "client_name_canonical", header: "Cliente" },
      { key: "site_abbreviation", header: "Sede" },
      { key: "equipment_model", header: "Modelo" },
      { key: "serial_number", header: "N° de serie" },
      { key: "contract_status_code", header: "Estado de contrato" },
      { key: "spa_tier_code", header: "Nivel SPA" },
      { key: "weekday_service", header: "Servicio en semana", format: formatBool },
      { key: "weekend_service", header: "Servicio fin de semana", format: formatBool },
      { key: "support_mode_code", header: "Modo de soporte" },
      { key: "warranty_end_date", header: "Fin de garantía", format: formatDate },
      { key: "match_status", header: "Match FieldBeat" }
    ],
    relatedSections: [
      {
        key: "versionHistory",
        label: "Historial de versiones",
        columns: [
          { key: "valid_from", header: "Vigente desde", format: formatDate },
          { key: "valid_to", header: "Vigente hasta", format: formatDate },
          { key: "contract_status_code", header: "Estado" },
          { key: "spa_tier_code", header: "Nivel SPA" }
        ]
      }
    ]
  },
  issues: {
    label: "Incidencias",
    singularLabel: "Incidencia",
    description: "Backlog de incidencias de Auditoría - solo lectura; usa la Bandeja de Auditoría para actuar sobre una incidencia.",
    // Orden: qué pasó (regla/severidad/estado) antes que dónde pasó (entidad),
    // antes que cuándo (detección) - "trazabilidad"/"estado del dato siempre
    // visible" (docs/design-context/09-design-principles.md). rule_code
    // crudo nunca se muestra: rule_title viene de governance.rule_definitions
    // (lib/explorer-sql.ts fetchIssuesList/fetchIssueDetail, LEFT JOIN).
    listColumns: [
      { key: "rule_title", header: "Regla" },
      { key: "severity", header: "Severidad", format: value => severityBadge(value as string).label },
      { key: "status", header: "Estado", format: value => issueStatusBadge(value as string).label },
      { key: "entity_type", header: "Entidad afectada", format: (value, row) => `${entityTypeLabel(value as string)}: ${formatValue(row.entity_key)}` },
      { key: "verification_processing_status", header: "Verificación", format: formatVerification },
      { key: "is_currently_detected", header: "Detectada actualmente", format: formatBool, optional: true },
      { key: "last_seen_at", header: "Antigüedad", format: formatDate }
    ],
    detailKeyColumn: "id",
    detailFields: [
      { key: "rule_title", header: "Regla" },
      { key: "severity", header: "Severidad", format: value => severityBadge(value as string).label },
      { key: "status", header: "Estado", format: value => issueStatusBadge(value as string).label },
      { key: "entity_type", header: "Entidad afectada", format: (value, row) => `${entityTypeLabel(value as string)}: ${formatValue(row.entity_key)}` },
      { key: "occurrence_key", header: "Referencia de ocurrencia" },
      { key: "is_currently_detected", header: "Detectada actualmente", format: formatBool },
      { key: "first_seen_at", header: "Primera detección", format: formatDate },
      { key: "last_seen_at", header: "Última detección", format: formatDate },
      { key: "resolution_type", header: "Tipo de resolución", format: formatResolutionType },
      { key: "closed_at", header: "Cerrada", format: formatDate }
    ],
    relatedSections: [
      {
        key: "evidence",
        label: "Evidencia",
        columns: [
          { key: "evidence_type", header: "Tipo", format: value => evidenceTypeLabel(value as string) },
          { key: "rule_version", header: "Versión de regla" },
          { key: "captured_at", header: "Capturada", format: formatDate }
        ]
      }
    ]
  }
};

export function formatCell(column: ExplorerColumn, row: Record<string, unknown>): string {
  const value = row[column.key];
  return column.format ? column.format(value, row) : formatValue(value);
}
