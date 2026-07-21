import type { FieldbeatDashboardResponse } from "@/types/fieldbeat";

// ETAPA 5 - evaluateFieldbeatPageStatus() recibe SOLO un contrato ya
// validado y normalizado por parseFieldbeatDashboardResponse - nunca ve un
// error de transporte (fetch falló / response.ok=false) ni un
// FieldbeatContractError (parseo falló): ambos se resuelven antes, dentro
// de use-fieldbeat-dashboard.ts, como status:"error" del hook. Esta
// función solo decide CÓMO presentar una respuesta que sí se pudo obtener
// e interpretar.
export type FieldbeatPageDataStatus = "empty" | "partial_inconsistent" | "zero_universe" | "success";

// "Actividad" en dataQuality se mide por la SUMA de report_count, nunca
// por dataQuality.length - el array siempre puede tener filas (incluso
// las 6 categorías canónicas) con report_count=0 sin que eso signifique
// actividad real (ver test dedicado).
function dataQualityHasActivity(data: FieldbeatDashboardResponse): boolean {
  return data.dataQuality.some(row => row.report_count > 0);
}

function anyCollectionHasActivity(data: FieldbeatDashboardResponse): boolean {
  return data.reportsByClient.length > 0 || data.partsConsumptionByClient.length > 0 || data.topEquipmentByParts.length > 0 || dataQualityHasActivity(data);
}

export function evaluateFieldbeatPageStatus(data: FieldbeatDashboardResponse): FieldbeatPageDataStatus {
  if (data.kpis === null) {
    // kpis nulo pero alguna colección con actividad real es una respuesta
    // inconsistente en sí misma (no se colapsa en "vacío genérico" -
    // el Shell muestra lo que sí hay, con una nota de inconsistencia).
    return anyCollectionHasActivity(data) ? "partial_inconsistent" : "empty";
  }

  if (data.kpis.total_fieldbeat_reports === 0) {
    return anyCollectionHasActivity(data) ? "partial_inconsistent" : "zero_universe";
  }

  return "success";
}
