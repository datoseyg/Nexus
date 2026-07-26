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
