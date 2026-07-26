import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQueryWithoutJit, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildReportDetailQuery, parseFieldbeatTaskId, shapeReportDetail } from "@/lib/fieldbeat-report-detail-queries";
import { isFieldbeatOpenConfigured } from "@/lib/fieldbeat-open-url";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Detalle maestro de un reporte FieldBeat (Phase 5) - prolongación fiel de
// la fila de la bandeja de Reportes y de los 6 KPI: reutiliza las MISMAS
// vistas quality.* (nunca reimplementa clasificación), 1 round-trip (ver
// lib/fieldbeat-report-detail-queries.ts).
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const { id } = await params;

  try {
    const fieldbeatTaskId = parseFieldbeatTaskId(id);
    const { sql, params: sqlParams } = buildReportDetailQuery(fieldbeatTaskId);
    // runQueryWithoutJit, no runQuery: ver el comentario en lib/db.ts -
    // esta consulta de 1 fila con varias correlated subqueries dispara
    // compilación JIT completa por el estimado pesimista del planner
    // (~1.7s de puro overhead de compilación, medido), sin ningún
    // beneficio real dado que solo procesa 1 fila.
    const rows = await runQueryWithoutJit<Record<string, unknown>>(sql, sqlParams);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `No existe un reporte FieldBeat con ID ${fieldbeatTaskId}`, code: "NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const detail = shapeReportDetail(serializeRows(rows)[0] as never, isFieldbeatOpenConfigured());
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
