// Extraídas a un módulo puro (Phase 3 reapertura §4) - antes vivían
// inline dentro de cada componente de pestaña, sin test directo (el viejo
// evaluateFieldbeatPageStatus(), que sí tenía 10 tests, cubría un
// clasificador de 4 estados sobre el contrato GOLD retirado - no es un
// reemplazo 1:1: cada pestaña nueva define su propia noción, mucho más
// simple, de "vacío" sobre su propio contrato v2). isDetailEmpty (Reportes,
// contrato viejo /detail) no se tocó - ya era un one-liner trivial
// preexistente, sin relación con este rediseño.
import type { FieldbeatOverviewResponse, FieldbeatQualityResponse } from "@/types/fieldbeat-quality";
import type { FieldbeatCrossingResponse } from "@/types/fieldbeat-crossings";
import type { FieldbeatReportsResponse } from "@/types/fieldbeat-reports";

export function isOverviewEmpty(body: FieldbeatOverviewResponse): boolean {
  return body.kpi1.denominator === 0 && body.kpi3.denominator === 0 && body.kpi5.evaluableReports === 0;
}

export function isQualityEmpty(body: FieldbeatQualityResponse): boolean {
  return body.kpi1.denominator === 0 && body.kpi3.denominator === 0 && body.kpi4.reportGrain.universe === 0;
}

export function isCrossingEmpty(body: FieldbeatCrossingResponse): boolean {
  return body.grandTotal === 0;
}

export function isReportsEmpty(body: FieldbeatReportsResponse): boolean {
  return body.totalRows === 0;
}
