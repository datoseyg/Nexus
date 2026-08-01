// Contratos del Explorador semántico (Gate B, B20/B21/B46) - navegación por
// entidad de negocio, nunca por schema.tabla física. Cada entidad tiene su
// propio contrato de campos allowlisted (nunca SELECT *, nunca columnas
// determinadas por information_schema) y su propia resolución de identidad
// canónica (B46) - ver ENTITY_IDENTITY más abajo.

export type ExplorerEntity =
  | "clients"
  | "equipment"
  | "technicians"
  | "reports"
  | "tickets"
  | "parts"
  | "products"
  | "contracts"
  | "issues";

export type ExplorerResolutionStatus = "DIRECT" | "RESOLVED" | "UNRESOLVED";

export interface ExplorerEntityIdentity {
  entityType: ExplorerEntity;
  resolutionStatus: ExplorerResolutionStatus;
  /** Explica por qué resolutionStatus es lo que es - siempre presente,
   * nunca solo para el caso RESOLVED (B46: la ausencia de relación también
   * se documenta, no solo la presencia). */
  resolutionNote: string;
}

// B46 - identidad canónica declarada por entidad, nunca asumida igual a una
// PK física a través de fuentes distintas sin confirmarlo.
export const ENTITY_IDENTITY: Record<ExplorerEntity, ExplorerEntityIdentity> = {
  clients: {
    entityType: "clients",
    resolutionStatus: "DIRECT",
    resolutionNote: "processed.fieldbeat_clients.client_key es la única fuente estructurada - no se fusiona con ningún cliente de Zendesk/Dolibarr sin una resolución validada."
  },
  equipment: {
    entityType: "equipment",
    resolutionStatus: "DIRECT",
    resolutionNote: "processed.fieldbeat_equipments.internal_id es la fuente estructurada. Equipos mencionados solo como texto libre en un reporte (sin match estructurado) no aparecen acá - ver quality.fieldbeat_team_identification para esa vista aparte."
  },
  technicians: {
    entityType: "technicians",
    resolutionStatus: "RESOLVED",
    resolutionNote: "canonical_person_key de manual_review.fieldbeat_engineer_identity_map cuando existe mapeo; participantes sin mapeo se muestran con su representación de origen cruda, nunca con una identidad inventada."
  },
  reports: {
    entityType: "reports",
    resolutionStatus: "DIRECT",
    resolutionNote: "fieldbeat_task_id es la clave primaria real del pipeline, sin ambigüedad."
  },
  tickets: {
    entityType: "tickets",
    resolutionStatus: "DIRECT",
    resolutionNote: "zendesk_ticket_id es la clave primaria real de Zendesk."
  },
  parts: {
    entityType: "parts",
    resolutionStatus: "RESOLVED",
    resolutionNote: "Modelo de 3 identidades ya resuelto por el hotfix FieldBeat: catalog-product:<ref> (RESOLVED), raw-part:<normalizado> (DIRECT, mismo código exacto), raw-occurrence:<used_part_id> (UNRESOLVED, nunca agrupado)."
  },
  products: {
    entityType: "products",
    resolutionStatus: "DIRECT",
    resolutionNote: "processed.dolibarr_products.ref es la referencia real del catálogo Dolibarr."
  },
  contracts: {
    entityType: "contracts",
    resolutionStatus: "DIRECT",
    resolutionNote: "Único acceso permitido es la vista curada de config.* ya otorgada - las tablas base siguen REVOKE'd, nunca se tocan directo."
  },
  issues: {
    entityType: "issues",
    resolutionStatus: "DIRECT",
    resolutionNote: "governance.issues.id (bigserial) - vista de solo lectura del backlog de Auditoría, enlaza al flujo de Auditoría para actuar, nunca permite acciones desde acá."
  }
};

export interface ExplorerListResponse<TRow = Record<string, unknown>> {
  entity: ExplorerEntity;
  rows: TRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

/** Respuesta de GET /api/explorer/[entity]/facets - opciones reales para los
 * <select> de la tarjeta de filtros (sección 6), scoped a la entidad activa
 * (nunca las 9 entidades cargadas de una). Única fuente de estas opciones -
 * el listado paginado (ExplorerListResponse) nunca vuelve a incluirlas. */
export interface ExplorerFacetsResponse {
  entity: ExplorerEntity;
  facets: Record<string, Array<{ value: string; label: string }>>;
}

export interface ExplorerDetailResponse<TSummary = unknown> {
  entity: ExplorerEntity;
  identity: ExplorerEntityIdentity;
  summary: TSummary;
  related: Record<string, unknown[]>;
}
