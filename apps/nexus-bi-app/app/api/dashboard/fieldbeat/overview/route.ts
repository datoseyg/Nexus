import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { parseFieldbeatQualityFilters, filtersAppliedForMetadata } from "@/lib/fieldbeat-quality-filters";
import { computeOverviewBundle } from "@/lib/fieldbeat-quality-queries";
import { FIELDBEAT_QUALITY_CONTRACT_VERSION, type FieldbeatOverviewResponse } from "@/types/fieldbeat-quality";

export const runtime = "nodejs";

// Phase 3 preflight §1.1 - alimenta la Visión ejecutiva (6 KPI) en
// EXACTAMENTE 1 round-trip SQL: computeOverviewBundle() ejecuta UNA sola
// consulta con los 6 KPI como CTEs (ver lib/fieldbeat-quality-queries.ts).
// La versión anterior de Phase 2 corría 8 queries independientes
// (Promise.all sobre 6 funciones, 2 de las cuales hacían 2 queries cada
// una) contra el pool compartido de 5 conexiones de lib/db.ts - 8
// adquisiciones simultáneas sobre un pool de 5, mal descrito como "1
// round-trip" cuando en realidad eran 8. Corregido: 1 query = 1
// adquisición = 1 round-trip real.
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
    const { kpi1, kpi2, kpi3, kpi4, kpi5, kpi6, evolution } = await computeOverviewBundle(filters);

    const body: FieldbeatOverviewResponse = {
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
      kpi6,
      evolution
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
