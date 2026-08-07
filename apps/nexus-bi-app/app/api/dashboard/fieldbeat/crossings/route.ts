import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { parseFieldbeatQualityFilters, filtersAppliedForMetadata } from "@/lib/fieldbeat-quality-filters";
import { queryCrossing, pivotCrossing } from "@/lib/fieldbeat-crossings-queries";
import { CROSSING_TYPES, CROSSING_LABELS, type CrossingType, type FieldbeatCrossingResponse } from "@/types/fieldbeat-crossings";

export const runtime = "nodejs";

// Phase 3 §9 - endpoint dedicado a los 6 cruces orientados a problemas,
// NUNCA precargado en overview - el frontend solo llama esto cuando la
// pestaña Cruces está abierta, y solo para el cruce seleccionado (el
// primero por defecto, los demás bajo demanda). `type` es un allowlist
// estricto (CROSSING_TYPES) - un valor fuera de esa lista es 400, nunca se
// interpola en SQL. Nunca reintroduce el cruce operacional cliente x
// equipo (eliminado, ver §11 del encargo).
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const typeParam = request.nextUrl.searchParams.get("type");
  if (!typeParam || !(CROSSING_TYPES as readonly string[]).includes(typeParam)) {
    return NextResponse.json(
      {
        error: `type inválido o ausente (permitidos: ${CROSSING_TYPES.join(", ")})`,
        code: "INVALID_QUERY_PARAMS",
        details: [`type: valor desconocido "${typeParam ?? ""}"`]
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const type = typeParam as CrossingType;

  const { filters, errors } = parseFieldbeatQualityFilters(request.nextUrl.searchParams);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Parámetros de filtro inválidos", code: "INVALID_QUERY_PARAMS", details: errors },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const pairs = await queryCrossing(type, filters);
    const pivoted = pivotCrossing(pairs);
    const labels = CROSSING_LABELS[type];

    const body: FieldbeatCrossingResponse = {
      type,
      rowDimensionLabel: labels.row,
      colDimensionLabel: labels.col,
      rows: pivoted.rows,
      cols: pivoted.cols,
      cells: pivoted.cells,
      rowTotals: pivoted.rowTotals,
      colTotals: pivoted.colTotals,
      grandTotal: pivoted.grandTotal,
      totalRows: pivoted.totalRows,
      totalCols: pivoted.totalCols,
      shownRows: pivoted.shownRows,
      shownCols: pivoted.shownCols,
      aggregated: pivoted.aggregated,
      generatedAt: new Date().toISOString(),
      filtersApplied: filtersAppliedForMetadata(filters)
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
