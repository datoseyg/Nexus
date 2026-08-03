import { NextRequest, NextResponse } from "next/server";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { explorerFiltersFor, type ExplorerDynamicOptionsKey } from "@/lib/explorer-filters-config";
import { handleApiError } from "@/lib/api-error";
import {
  fetchClientNameOptions,
  fetchContractClientOptions,
  fetchClientCityOptions,
  fetchClientCommuneOptions,
  fetchEquipmentTypeOptions,
  fetchEquipmentModelOptions,
  fetchReportTaskTypes,
  fetchReportEquipmentInternalIdOptions,
  fetchReportTechnicianOptions,
  fetchTicketStatusOptions,
  fetchProductSaleStatusOptions,
  fetchProductPurchaseStatusOptions,
  fetchIssueRuleCodeOptions
} from "@/lib/explorer-sql";
import type { ExplorerEntity, ExplorerFacetsResponse } from "@/types/explorer";

export const runtime = "nodejs";

// GET /api/explorer/[entity]/facets - opciones reales para la tarjeta de
// filtros (sección 14: "carga únicamente las facets de la entidad activa,
// nunca las 9 entidades al montar el Explorador"). Calcula SOLO las claves
// que lib/explorer-filters-config.ts declara para esta entidad - nunca todas
// las funciones de facet disponibles.
const SUPPORTED_ENTITIES: ExplorerEntity[] = ["reports", "tickets", "parts", "issues", "clients", "equipment", "technicians", "products", "contracts"];

async function resolveFacet(key: ExplorerDynamicOptionsKey): Promise<Array<{ value: string; label: string }>> {
  switch (key) {
    case "clientes":
      return (await fetchClientNameOptions()).map(v => ({ value: v, label: v }));
    case "contractClients":
      return fetchContractClientOptions();
    case "cities":
      return (await fetchClientCityOptions()).map(v => ({ value: v, label: v }));
    case "communes":
      return (await fetchClientCommuneOptions()).map(v => ({ value: v, label: v }));
    case "equipmentTypes":
      return (await fetchEquipmentTypeOptions()).map(v => ({ value: v, label: v }));
    case "models":
      return (await fetchEquipmentModelOptions()).map(v => ({ value: v, label: v }));
    case "taskTypes":
      return (await fetchReportTaskTypes()).map(v => ({ value: v, label: v }));
    case "equipmentInternalIds":
      return (await fetchReportEquipmentInternalIdOptions()).map(v => ({ value: v, label: v }));
    case "technicianNames":
      return (await fetchReportTechnicianOptions()).map(v => ({ value: v, label: v }));
    case "ticketStatuses":
      return (await fetchTicketStatusOptions()).map(v => ({ value: v, label: v }));
    case "saleStatuses":
      return (await fetchProductSaleStatusOptions()).map(v => ({ value: v, label: v }));
    case "purchaseStatuses":
      return (await fetchProductPurchaseStatusOptions()).map(v => ({ value: v, label: v }));
    case "ruleCodes":
      return fetchIssueRuleCodeOptions();
    default:
      return [];
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const { entity: rawEntity } = await params;
    if (!SUPPORTED_ENTITIES.includes(rawEntity as ExplorerEntity)) {
      return NextResponse.json({ error: `Entidad de Explorador no soportada: "${rawEntity}"`, code: "NOT_FOUND" }, { status: 404 });
    }
    const entity = rawEntity as ExplorerEntity;

    const dynamicKeys = Array.from(
      new Set(explorerFiltersFor(entity).map(def => def.dynamicOptionsKey).filter((key): key is ExplorerDynamicOptionsKey => Boolean(key)))
    );

    const entries = await Promise.all(dynamicKeys.map(async key => [key, await resolveFacet(key)] as const));
    const facets = Object.fromEntries(entries);

    const body: ExplorerFacetsResponse = { entity, facets };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
