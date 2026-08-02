// Configuración de presentación del Explorador semántico - solo metadata de
// columnas/campos (nunca lógica de consulta, eso vive en explorer-sql.ts,
// server-only). Un componente de tabla y un componente de drawer genéricos,
// configurados por entidad - NUNCA 9 componentes de tabla/drawer separados
// (B20: "reutilizar, no reinventar").
import type { ExplorerEntity } from "@/types/explorer";
import {
  entityTypeLabel,
  evidenceTypeLabel,
  verificationProcessingStatusLabel,
  verificationOutcomeLabel,
  severityLabel,
  issueStatusLabel
} from "@/lib/audit-vocabulary";
import {
  contractStatusLabel,
  spaTierLabel,
  supportModeLabel,
  partsCoverageLabel,
  contractFeatureLabel,
  contractMatchStatusLabel,
  contractMatchMethodLabel,
  preventiveMaintenanceLabel
} from "@/lib/contracts-vocabulary";

export interface ExplorerColumn {
  key: string;
  header: string;
  format?: (value: unknown, row: Record<string, unknown>) => string;
  /** Columna ocultable desde "Columnas visibles" (barra de herramientas de
   * tabla) - solo alterna columnas YA allowlisted acá, nunca revela un
   * campo nuevo (B21). Sin esta marca, la columna es obligatoria. */
  optional?: boolean;
  /** Solo aplica a detailFields: agrupa el campo bajo el disclosure
   * colapsado "Detalles técnicos" del drawer genérico (ExplorerDetailDrawer)
   * en vez del cuerpo principal - para señales de trazabilidad/auditoría
   * que no son la primera pregunta de negocio (qué/dónde/severidad/estado),
   * sino soporte para quien ya decidió investigar más a fondo. Sin esta
   * marca, el campo es primario y siempre visible. */
  technical?: boolean;
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
    /** "Ver equipo"/"Ver cliente" POR FILA de esta sección relacionada -
     * navega al detalle canónico exacto de esa fila (nunca a un listado
     * filtrado como viewAllLink) reemplazando el contenido del drawer vía
     * ExplorerShell.navigateToDetail, nunca apilando un segundo drawer.
     * keyField es la columna de `rows` que trae la clave canónica de la
     * entidad destino (ej. equipment_key). */
    rowLink?: { entity: ExplorerEntity; keyField: string; label?: string };
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

// Candidatos de contrato de un Equipo (ver EQUIPMENT_CONTRACT_CANDIDATES_LATERAL,
// explorer-sql.ts): SIEMPRE un arreglo (0, 1 o más valores DISTINCT), nunca
// se colapsa eligiendo uno vía MAX/MIN/primera fila. El caso real de hoy
// (0 o 1 valor) se ve idéntico a un campo simple; si alguna vez hay 2+
// contratos en desacuerdo para el mismo equipo, ambos valores quedan visibles
// unidos por " / " en vez de que uno oculte al otro.
function formatDistinctList(value: unknown, itemFormat: (item: unknown) => string = formatValue): string {
  if (!Array.isArray(value)) return formatValue(value);
  const formatted = value.filter(item => item !== null && item !== undefined && item !== "").map(itemFormat);
  return formatted.length > 0 ? formatted.join(" / ") : "-";
}

// Celda "Modelo" - usa SIEMPRE model_resolution_status ya resuelto en SQL
// (EQUIPMENT_MODEL_RESOLUTION_COLUMNS, explorer-sql.ts), nunca elige un
// candidato en el cliente: RESOLVED muestra el modelo (row.model, ya
// singular); AMBIGUOUS muestra "Modelo por confirmar" (row.model es NULL a
// propósito - los candidatos en desacuerdo viven en el detalle técnico, ver
// equipment_models); UNKNOWN muestra "—" (guion largo, NUNCA "-"/"N/A"/"NA"/
// null/"" - Sección 14.2 del encargo NEXUS V3 After-Hours prohíbe
// explícitamente esos valores para "modelo no identificado". Exportada -
// components/after-hours/AfterHoursDetailTable.tsx reutiliza esta misma
// función para su propia columna "Modelo", en vez de reimplementar el
// fallback).
export function formatModelCell(value: unknown, row: Record<string, unknown>): string {
  if (row.model_resolution_status === "AMBIGUOUS") return "Modelo por confirmar";
  if (row.model_resolution_status === "UNKNOWN" || value === null || value === undefined || value === "") return "—";
  return formatValue(value);
}

// Mantenimiento preventivo por equipo - preventive_maintenance_mins/maxs/rules
// llegan como 3 arreglos paralelos DISTINCT (ver EQUIPMENT_CONTRACT_CANDIDATES_LATERAL,
// explorer-sql.ts). Con 0 o 1 contrato vigente (el caso real de hoy) se ve
// como una sola cifra con su unidad/periodo real (nunca "horas", ver
// preventiveMaintenanceLabel); con 2+ en desacuerdo, nunca se promedian ni
// suman - se marca explícitamente para revisar en el detalle en vez de
// mostrar un número fabricado.
function formatPreventiveMaintenanceCell(row: Record<string, unknown>): string {
  const mins = Array.isArray(row.preventive_maintenance_mins) ? row.preventive_maintenance_mins : [];
  const maxs = Array.isArray(row.preventive_maintenance_maxs) ? row.preventive_maintenance_maxs : [];
  const rules = Array.isArray(row.preventive_maintenance_rules) ? row.preventive_maintenance_rules : [];
  if (mins.length === 0 && maxs.length === 0 && rules.length === 0) return "-";
  if (mins.length > 1 || maxs.length > 1 || rules.length > 1) return "Varios contratos - ver detalle";
  return preventiveMaintenanceLabel(mins[0] ?? null, maxs[0] ?? null, rules[0] ?? null);
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
      {
        key: "city",
        header: "Ubicación",
        format: (value, row) => {
          const base = [value, row.commune].filter(Boolean).join(" - ") || "Sin ubicación";
          const count = Number(row.location_count ?? 1);
          return count > 1 ? `${base} · ${count} sedes` : base;
        }
      },
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
      { key: "address_raw", header: "Dirección", format: value => (value ? String(value) : "Sin dirección registrada") },
      { key: "location_count", header: "Sedes", format: value => (Number(value ?? 1) > 1 ? `${value} ubicaciones distintas` : "1 ubicación") },
      { key: "report_count", header: "Reportes" },
      { key: "ticket_count", header: "Tickets" },
      { key: "used_parts_count", header: "Repuestos usados" },
      // Resumen - el desglose real (1 fila por equipo cubierto, nunca un
      // "tipo de contrato" fabricado desde la primera fila) vive en la
      // sección "Contratos y cobertura" de relatedSections.
      { key: "contract_equipment_count", header: "Equipos con contrato vigente" }
    ],
    relatedSections: [
      {
        key: "equipment",
        label: "Equipos",
        columns: [
          { key: "internal_id", header: "Equipo" },
          // model_resolution_status ya resuelto en la consulta (nunca
          // MAX/MIN/primera fila, ver EQUIPMENT_MODEL_RESOLUTION_COLUMNS en
          // explorer-sql.ts) - "Modelo por confirmar" cuando hay 2+ modelos
          // en desacuerdo, nunca uno elegido en silencio.
          { key: "model", header: "Modelo", format: (value, row) => formatModelCell(value, row) },
          // equipment_type = familia (LINAC/CT/RX/...), inferida del propio
          // identificador - señal secundaria, nunca sustituye al modelo real.
          { key: "equipment_type", header: "Familia", optional: true },
          { key: "contract_status_codes", header: "Cobertura", format: value => formatDistinctList(value, contractStatusLabel) },
          { key: "report_count", header: "Reportes" },
          { key: "active_issue_count", header: "Incidencias activas" }
        ],
        rowLink: { entity: "equipment", keyField: "equipment_key", label: "Ver equipo" }
      },
      {
        // Sección 9 - "Contratos y cobertura": 1 fila POR EQUIPO cubierto
        // (grano real evidenciado, ver comentario junto a
        // CONTRACTS_FILTER_COLUMNS en explorer-sql.ts) - nunca resumido en un
        // único "tipo de contrato" del cliente, y el mantenimiento preventivo
        // nunca se suma entre equipos con unidades/reglas distintas
        // (formatPreventiveMaintenanceCell muestra cada fila con su propia
        // cifra y periodo real).
        key: "contractsCoverage",
        label: "Contratos y cobertura",
        columns: [
          { key: "internal_id", header: "Equipo" },
          { key: "model", header: "Modelo", format: (value, row) => formatModelCell(value, row) },
          { key: "contract_status_codes", header: "Estado", format: value => formatDistinctList(value, contractStatusLabel) },
          { key: "preventive_maintenance_mins", header: "Mantenimiento preventivo", format: (_value, row) => formatPreventiveMaintenanceCell(row) }
        ],
        rowLink: { entity: "equipment", keyField: "equipment_key", label: "Ver equipo" }
      },
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
      },
      {
        // Solo presente cuando el cliente tiene más de una dirección real
        // distinta (sedes genuinas) - ver fetchClientDetail en explorer-sql.ts.
        // Nunca se muestra para el caso común de filas físicas duplicadas
        // con la misma dirección o con dirección ausente.
        key: "locations",
        label: "Ubicaciones",
        columns: [
          { key: "address_raw", header: "Dirección" },
          { key: "commune", header: "Comuna" },
          { key: "city", header: "Ciudad" }
        ]
      }
    ]
  },
  equipment: {
    label: "Equipos",
    singularLabel: "Equipo",
    description: "Equipos con identidad canónica (identificador + cliente, sin duplicados de mayúsculas/aliases) y su modelo real de contrato.",
    listColumns: [
      { key: "internal_id", header: "Equipo" },
      // Modelo real primero que la familia - "Tipo: LINAC" nunca sustituye
      // al modelo cuando existe (Platform/Synergy/VersaHD/...), ver
      // formatModelCell arriba.
      { key: "model", header: "Modelo", format: (value, row) => formatModelCell(value, row) },
      { key: "client_name", header: "Cliente" },
      { key: "contract_status_codes", header: "Contrato/cobertura", format: value => formatDistinctList(value, contractStatusLabel) },
      // Familia (LINAC/CT/RX/BRAQUITERAPIA) - señal secundaria/filtrable,
      // oculta por defecto en columnas visibles, NUNCA la etiqueta principal
      // del equipo cuando hay modelo real (sección 7 de la corrección).
      { key: "equipment_type", header: "Familia", optional: true },
      // optional: true = oculta en pantalla por defecto pero SIEMPRE presente
      // en la exportación CSV (el exportador usa listColumns completo, nunca
      // filtra por columnas ocultas - ver app/api/explorer/[entity]/export/route.ts).
      { key: "serial_numbers", header: "N° de serie", format: value => formatDistinctList(value), optional: true },
      { key: "preventive_maintenance_mins", header: "Mantenimiento preventivo", format: (_value, row) => formatPreventiveMaintenanceCell(row), optional: true },
      { key: "report_count", header: "Reportes" },
      { key: "active_issue_count", header: "Incidencias activas" }
    ],
    detailKeyColumn: "equipment_key",
    detailFields: [
      { key: "internal_id", header: "Equipo" },
      { key: "model", header: "Modelo", format: (value, row) => formatModelCell(value, row) },
      { key: "equipment_type", header: "Familia" },
      { key: "client_name", header: "Cliente" },
      { key: "serial_numbers", header: "N° de serie", format: value => formatDistinctList(value) },
      { key: "contract_status_codes", header: "Estado de contrato", format: value => formatDistinctList(value, contractStatusLabel) },
      { key: "match_statuses", header: "Vínculo con FieldBeat", format: value => formatDistinctList(value, contractMatchStatusLabel) },
      { key: "warranty_end_dates", header: "Fin de garantía", format: value => formatDistinctList(value, formatDate) },
      // Única cifra contractual real con unidad/periodo propios (ver
      // formatPreventiveMaintenanceCell) - nunca "horas contractuales"
      // (ese campo no existe en la fuente).
      { key: "preventive_maintenance_mins", header: "Mantenimiento preventivo", format: (_value, row) => formatPreventiveMaintenanceCell(row) },
      { key: "report_count", header: "Reportes" },
      // Candidatos de modelo/serie/contrato SIN resolver a un solo valor -
      // solo relevante cuando model_resolution_status = AMBIGUOUS o para
      // auditar de dónde vino el modelo resuelto (procedencia). Nunca se usa
      // para elegir uno, ver EQUIPMENT_CONTRACT_CANDIDATES_LATERAL.
      { key: "equipment_models", header: "Modelos candidatos (contrato)", format: value => formatDistinctList(value), technical: true },
      { key: "contract_keys", header: "Contratos vinculados", format: value => formatDistinctList(value), technical: true },
      { key: "source_equipment_keys", header: "Representaciones de origen (FieldBeat)", format: value => formatDistinctList(value), technical: true }
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
    // Grano real evidenciado (ver comentario extenso junto a
    // CONTRACTS_FILTER_COLUMNS en explorer-sql.ts): una fila = la cobertura
    // contractual de UN equipo específico - no existe en la fuente un
    // identificador de "contrato maestro" que agrupe varios equipos, así que
    // "Contrato" y "cobertura de este equipo" son la misma cosa hoy.
    description: "Cobertura contractual vigente por equipo (un contrato = un equipo, ver evidencia de grano en el código).",
    listColumns: [
      { key: "client_name_canonical", header: "Cliente" },
      { key: "equipment_model", header: "Equipo" },
      { key: "contract_status_code", header: "Estado", format: value => contractStatusLabel(value) },
      { key: "spa_tier_code", header: "Nivel SPA", format: value => spaTierLabel(value), optional: true },
      { key: "serial_number", header: "N° de serie", optional: true },
      {
        key: "preventive_maintenance_min",
        header: "Mantenimiento preventivo",
        format: (_value, row) => preventiveMaintenanceLabel(row.preventive_maintenance_min, row.preventive_maintenance_max, row.preventive_maintenance_rule),
        optional: true
      },
      { key: "match_status", header: "Vínculo FieldBeat", format: value => contractMatchStatusLabel(value), optional: true }
    ],
    detailKeyColumn: "equipment_key",
    detailFields: [
      { key: "client_name_canonical", header: "Cliente" },
      { key: "site_abbreviation", header: "Sede" },
      { key: "equipment_model", header: "Modelo" },
      { key: "serial_number", header: "N° de serie" },
      { key: "contract_status_code", header: "Estado de contrato", format: value => contractStatusLabel(value) },
      { key: "spa_tier_code", header: "Nivel/plan", format: value => spaTierLabel(value) },
      { key: "weekday_service", header: "Servicio en semana", format: formatBool },
      { key: "weekend_service", header: "Servicio fin de semana", format: formatBool },
      { key: "support_mode_code", header: "Modo de soporte", format: value => supportModeLabel(value) },
      { key: "parts_coverage_code", header: "Cobertura de repuestos", format: value => partsCoverageLabel(value) },
      {
        // NO existe en la fuente un campo de "horas contractuales" (ni por
        // mes/año/trimestre) - ver el comentario exhaustivo en
        // lib/contracts-vocabulary.ts (preventiveMaintenanceLabel). Esta es
        // la ÚNICA cifra contractual real con unidad/periodo propios
        // (mantenimientos preventivos/año) - nunca se inventa una cifra de
        // horas que no está en los datos.
        key: "preventive_maintenance_min",
        header: "Mantenimiento preventivo",
        format: (_value, row) => preventiveMaintenanceLabel(row.preventive_maintenance_min, row.preventive_maintenance_max, row.preventive_maintenance_rule)
      },
      { key: "warranty_end_date", header: "Fin de garantía", format: formatDate },
      { key: "match_status", header: "Vínculo con FieldBeat", format: value => contractMatchStatusLabel(value) },
      { key: "hw_refresh_code", header: "Actualización de hardware", format: value => contractFeatureLabel(value), technical: true },
      { key: "updates_code", header: "Updates", format: value => contractFeatureLabel(value), technical: true },
      { key: "upgrades_code", header: "Upgrades", format: value => contractFeatureLabel(value), technical: true },
      { key: "match_method", header: "Método de vínculo FieldBeat", format: value => contractMatchMethodLabel(value), technical: true },
      // Referencia de texto cruda (nunca el equipment_key canónico de
      // FieldBeat - ver linked_equipment_key/"Ver equipo" arriba, ese es el
      // vínculo real y navegable) - queda como dato técnico de auditoría.
      { key: "fieldbeat_internal_id", header: "Referencia cruda vinculada", technical: true }
    ],
    relatedSections: [
      {
        // Ver comentario de grano arriba - hoy siempre 0 o 1 fila (el único
        // equipo con el que este contrato quedó vinculado), modelado como
        // lista para no asumir 1:1 permanentemente. Reutiliza la identidad
        // canónica de Equipos (nunca una consulta paralela).
        key: "coveredEquipment",
        label: "Equipos cubiertos",
        columns: [
          { key: "internal_id", header: "Equipo" },
          { key: "model", header: "Modelo", format: (value, row) => formatModelCell(value, row) },
          { key: "serial_numbers", header: "N° de serie", format: value => formatDistinctList(value) },
          { key: "match_statuses", header: "Vínculo FieldBeat", format: value => formatDistinctList(value, contractMatchStatusLabel) }
        ],
        rowLink: { entity: "equipment", keyField: "equipment_key", label: "Ver equipo" }
      },
      {
        key: "versionHistory",
        label: "Historial de versiones",
        columns: [
          { key: "valid_from", header: "Vigente desde", format: formatDate },
          { key: "valid_to", header: "Vigente hasta", format: formatDate },
          { key: "contract_status_code", header: "Estado", format: value => contractStatusLabel(value) },
          { key: "spa_tier_code", header: "Nivel/plan", format: value => spaTierLabel(value) }
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
      { key: "severity", header: "Severidad", format: value => severityLabel(value as string) },
      { key: "status", header: "Estado", format: value => issueStatusLabel(value as string) },
      { key: "entity_type", header: "Entidad afectada", format: (value, row) => `${entityTypeLabel(value as string)}: ${formatValue(row.entity_key)}` },
      { key: "verification_processing_status", header: "Verificación", format: formatVerification },
      { key: "is_currently_detected", header: "Detectada actualmente", format: formatBool, optional: true },
      { key: "last_seen_at", header: "Antigüedad", format: formatDate }
    ],
    detailKeyColumn: "id",
    // Primarios: qué/dónde/severidad/estado/antigüedad - la primera pregunta
    // de negocio, siempre visible. El resto (referencia de ocurrencia interna,
    // bandera de detección cruda, fechas de ciclo de vida) es trazabilidad
    // para quien ya decidió investigar más - va bajo "Detalles técnicos"
    // (technical: true, ver ExplorerColumn en este archivo).
    detailFields: [
      { key: "rule_title", header: "Regla" },
      { key: "severity", header: "Severidad", format: value => severityLabel(value as string) },
      { key: "status", header: "Estado", format: value => issueStatusLabel(value as string) },
      { key: "entity_type", header: "Entidad afectada", format: (value, row) => `${entityTypeLabel(value as string)}: ${formatValue(row.entity_key)}` },
      { key: "last_seen_at", header: "Última detección", format: formatDate },
      { key: "occurrence_key", header: "Referencia de ocurrencia", technical: true },
      { key: "is_currently_detected", header: "Detectada actualmente", format: formatBool, technical: true },
      { key: "first_seen_at", header: "Primera detección", format: formatDate, technical: true },
      { key: "resolution_type", header: "Tipo de resolución", format: formatResolutionType, technical: true },
      { key: "closed_at", header: "Cerrada", format: formatDate, technical: true }
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
