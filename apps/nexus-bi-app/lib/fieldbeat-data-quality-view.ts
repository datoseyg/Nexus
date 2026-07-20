import { KNOWN_REPORT_QUALITY_STATUSES } from "@/types/fieldbeat";
import type { FieldbeatDataQualityRow } from "@/types/fieldbeat";
import { percentLabel } from "./fieldbeat-metrics";

// ETAPA 5 - lógica pura de calidad de datos, sin JSX (node --test con
// --experimental-strip-types no puede cargar un .tsx, ni siquiera para
// importar una función sin JSX que conviva en el mismo módulo - por eso
// este archivo NO importa reportQualityBadge()/StatusBadge.tsx. La
// derivación de {label, tone} vive en el componente de presentación
// (components/fieldbeat/FieldbeatDataQuality.tsx, .tsx real, cargado por
// el bundler de Next.js) usando `isKnown` de acá para decidir entre
// reportQualityBadge(status) (ya confirmado que cubre los 6 valores
// reales, sin modificarlo) y el fallback "Estado no reconocido".
export interface FieldbeatDataQualityViewRow {
  status: string;
  count: number;
  percentLabel: string;
  isKnown: boolean;
}

const KNOWN_STATUS_SET: ReadonlySet<string> = new Set(KNOWN_REPORT_QUALITY_STATUSES);

export function isKnownReportQualityStatus(status: string): boolean {
  return KNOWN_STATUS_SET.has(status);
}

export function mapDataQualityRow(row: FieldbeatDataQualityRow, totalReports: number): FieldbeatDataQualityViewRow {
  return {
    status: row.report_quality_status,
    count: row.report_count,
    // Recalculado desde report_count/totalReports (coma decimal es-CL) -
    // nunca reutiliza row.percent_of_total_reports (TEXT preformateado,
    // formato en-US con punto), ver lib/fieldbeat-metrics.ts.
    percentLabel: percentLabel(row.report_count, totalReports),
    isKnown: isKnownReportQualityStatus(row.report_quality_status)
  };
}

// Orden canónico fijo (OK...REVIEW_REQUIRED); cualquier status desconocido
// se ubica después de las 6 categorías canónicas, nunca lanza. No muta el
// array de entrada.
export function orderDataQualityRows(rows: FieldbeatDataQualityRow[]): FieldbeatDataQualityRow[] {
  const canonicalOrder = KNOWN_REPORT_QUALITY_STATUSES as readonly string[];

  return [...rows].sort((a, b) => {
    const aIndex = canonicalOrder.indexOf(a.report_quality_status);
    const bIndex = canonicalOrder.indexOf(b.report_quality_status);
    const aRank = aIndex === -1 ? canonicalOrder.length : aIndex;
    const bRank = bIndex === -1 ? canonicalOrder.length : bIndex;
    return aRank - bRank;
  });
}
