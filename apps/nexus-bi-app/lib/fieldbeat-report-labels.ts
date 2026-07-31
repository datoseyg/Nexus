// Etiquetas en español compartidas entre FieldbeatReportDetailContent.tsx
// (drawer) y lib/fieldbeat-report-pdf.ts (Phase 6) - un único lugar de
// verdad para que ambas superficies digan EXACTAMENTE lo mismo ante el
// mismo dato (ver el bug real de Phase 5: un lookup contra el mapa
// equivocado mostraba el enum crudo en vez de una etiqueta).
import { formatDateTimeEsCl } from "./dashboard-formatters";

export const EQUIPMENT_SOURCE_LABEL: Record<string, string> = {
  STRUCTURED: "Estructurado",
  TEXT_RECOVERED: "Recuperado de texto",
  TEXT_AMBIGUOUS_CANDIDATE: "Candidato ambiguo"
};

// Etiqueta de data.equipment.status (TeamIdentificationStatus - el status
// del REPORTE) - distinto de EQUIPMENT_SOURCE_LABEL (la fuente de cada
// ITEM individual). Ver comentario histórico en git blame de
// FieldbeatReportDetailContent.tsx sobre el bug real de Phase 5 (lookup
// contra el mapa equivocado).
export const TEAM_IDENTIFICATION_STATUS_LABEL: Record<string, string> = {
  STRUCTURED_IDENTIFIED: "Estructurado",
  TEXT_CONFIDENT_IDENTIFIED: "Recuperado de texto",
  TEXT_AMBIGUOUS: "Ambiguo (sin confirmar)",
  MISSING: "No identificado",
  NOT_APPLICABLE: "No aplica"
};

// "Sin información" en vez del "-" por defecto de formatDateTimeEsCl()
// (Phase 5 §8.2: "no uses un guion en blanco para todos los casos").
export function formatFieldbeatDateTime(value: string | null): string {
  return value ? formatDateTimeEsCl(value) : "Sin información";
}

// HOTFIX de integridad de datos FieldBeat (post-Phase 6) - fuente única de
// verdad para las 5 superficies (drawer/PDF/CSV/Búsqueda/uso-reciente).
// NO_MATCH NUNCA debe leerse como "no existe" - solo "sin correspondencia
// validada en el catálogo Dolibarr" (bug real que motivó este hotfix: la UI
// imprimía el enum crudo sin traducir, ver git blame de
// FieldbeatReportDetailContent.tsx línea ~305).
export const CATALOG_MATCH_STATUS_LABEL: Record<string, string> = {
  CURRENT_DIRECT_MATCH: "Coincide con catálogo vigente",
  HISTORICAL_ALIAS_MATCH: "Equivalencia histórica curada",
  DESCRIPTION_CONFIDENT_MATCH: "Correspondencia de descripción verificada",
  AMBIGUOUS_MATCH: "Candidatos ambiguos (sin confirmar)",
  PLACEHOLDER_VALUE: "Valor placeholder (no es un número de parte real)",
  NO_MATCH: "Sin correspondencia validada en catálogo",
  // Declaración válida de ausencia de repuesto (N/A, no aplica, NC...) -
  // quality.classify_part_declaration (sql/098/086) - nunca un placeholder
  // que requiera revisión, nunca el enum crudo visible.
  NO_PART_USED: "Sin repuesto utilizado"
};

export const PARTICIPANT_ROLE_LABEL: Record<string, string> = {
  PRIMARY_ASSIGNEE: "Responsable principal",
  ADDITIONAL_STRUCTURED: "Adicional (seleccionado)",
  ADDITIONAL_FREE_TEXT: "Adicional (texto libre)",
  UNRESOLVED_ADDITIONAL: "Adicional (no resuelto)"
};

export const PARTICIPANT_RESOLUTION_STATUS_LABEL: Record<string, string> = {
  RESOLVED_ASSIGNED_TO: "Resuelto (responsable de la tarea)",
  RESOLVED_ROSTER_MATCH: "Resuelto (coincide con listado de ingenieros)",
  RESOLVED_CURATED_IDENTITY: "Resuelto (identidad verificada manualmente)",
  UNRESOLVED_FREE_TEXT: "No resuelto (nombre libre, sin coincidencia)",
  UNRESOLVED_UNKNOWN_TOKEN: "No resuelto (token desconocido)"
};
