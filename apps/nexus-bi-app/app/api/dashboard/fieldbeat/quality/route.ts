import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { parseFieldbeatQualityFilters, filtersAppliedForMetadata } from "@/lib/fieldbeat-quality-filters";
import { computeQualityBundle, HISTORICAL_ALIAS_LIMITATION_MESSAGE } from "@/lib/fieldbeat-quality-queries";
import { FIELDBEAT_QUALITY_CONTRACT_VERSION, type FieldbeatQualityResponse } from "@/types/fieldbeat-quality";

export const runtime = "nodejs";

// Phase 3 preflight §1.1 - alimenta "Calidad y trazabilidad" (KPI1/2/3/4/5)
// en EXACTAMENTE 1 round-trip SQL (computeQualityBundle(), ver
// lib/fieldbeat-quality-queries.ts). Incluye KPI2 (tickets, liviano) desde
// Phase 3 §8 - la pestaña Calidad necesita mostrar accesible/restringido-
// ausente/sin-ticket. Deliberadamente NO incluye KPI6 (inconsistencias,
// el más pesado de los 6, ver medición en el cierre de Phase 2) - ese vive
// solo en /overview. Mismas CTEs compartidas (CORE_KPI_CTES/TICKET_KPI_CTES)
// que /overview - una sola fuente, nunca dos fórmulas distintas para lo mismo.
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const { filters, errors } = parseFieldbeatQualityFilters(request.nextUrl.searchParams);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Parámetros de filtro inválidos", code: "INVALID_QUERY_PARAMS", details: errors },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const { kpi1, kpi2, kpi3, kpi4, kpi5, teamEvolution } = await computeQualityBundle(filters);

    const body: FieldbeatQualityResponse = {
      meta: {
        generatedAt: new Date().toISOString(),
        contractVersion: FIELDBEAT_QUALITY_CONTRACT_VERSION,
        effectiveDateFrom: filters.dateFrom ?? null,
        effectiveDateTo: filters.dateTo ?? null,
        filtersApplied: filtersAppliedForMetadata(filters)
      },
      kpi1,
      kpi2,
      kpi3,
      kpi4,
      kpi5,
      teamEvolution,
      historicalAliasLimitation: HISTORICAL_ALIAS_LIMITATION_MESSAGE
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
