import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { parseFieldbeatQualityFilters } from "@/lib/fieldbeat-quality-filters";
import {
  buildReportsListingQuery,
  parseReportsDirection,
  parseReportsPage,
  parseReportsPageSize,
  parseReportsSearch,
  parseReportsSort,
  parseReportsView,
  shapeReportRow
} from "@/lib/fieldbeat-reports-queries";
import type { FieldbeatReportsResponse } from "@/types/fieldbeat-reports";

export const runtime = "nodejs";

// Bandeja definitiva de Reportes (Phase 4) - reemplaza GET
// /api/dashboard/fieldbeat/detail (Phase 3 §10). 1 round-trip: la fila
// trae COUNT(*) OVER() ya calculado sobre el universo filtrado completo
// (antes del LIMIT/OFFSET, semántica estándar de SQL), así que la
// metadata de paginación no necesita una segunda consulta - ver
// lib/fieldbeat-reports-queries.ts.
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const searchParams = request.nextUrl.searchParams;
  const { filters, errors } = parseFieldbeatQualityFilters(searchParams);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Parámetros de filtro inválidos", code: "INVALID_QUERY_PARAMS", details: errors },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const view = parseReportsView(searchParams.get("reportsView"));
  const page = parseReportsPage(searchParams.get("page"));
  const pageSize = parseReportsPageSize(searchParams.get("pageSize"));
  const sort = parseReportsSort(searchParams.get("sort"));
  const direction = parseReportsDirection(searchParams.get("direction"));
  const search = parseReportsSearch(searchParams.get("search"));

  try {
    const options = { filters, view, search, sort, direction };
    let effectivePage = page;
    let { sql, params } = buildReportsListingQuery(options, effectivePage, pageSize);
    let rows = await runQuery<Record<string, unknown> & { total_count: string }>(sql, params);

    // COUNT(*) OVER() viaja en cada fila devuelta - si el OFFSET solicitado
    // cae más allá del total (ej. reportsPage=50 tras un filtro que dejó
    // solo 3 páginas), la consulta no devuelve NINGUNA fila y con ella se
    // pierde el total. Se reintenta una sola vez en página 1 para conocer
    // el total real y reportarlo, nunca "totalRows: 0" cuando en realidad
    // hay resultados fuera de rango.
    if (rows.length === 0 && effectivePage > 1) {
      effectivePage = 1;
      ({ sql, params } = buildReportsListingQuery(options, effectivePage, pageSize));
      rows = await runQuery<Record<string, unknown> & { total_count: string }>(sql, params);
    }

    const totalRows = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(effectivePage, totalPages);
    const effectiveRangeFrom = totalRows === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const effectiveRangeTo = totalRows === 0 ? 0 : Math.min(safePage * pageSize, totalRows);

    const body: FieldbeatReportsResponse = {
      rows: serializeRows(rows).map(row => shapeReportRow(row as never)),
      view,
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrevious: safePage > 1,
      effectiveRangeFrom,
      effectiveRangeTo,
      sort,
      direction,
      search
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
