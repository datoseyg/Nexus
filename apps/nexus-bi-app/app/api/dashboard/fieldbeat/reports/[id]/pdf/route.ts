import { NextRequest, NextResponse } from "next/server";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { runQueryWithoutJit, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildReportDetailQuery, parseFieldbeatTaskId, shapeReportDetail } from "@/lib/fieldbeat-report-detail-queries";
import { isFieldbeatOpenConfigured } from "@/lib/fieldbeat-open-url";
import { generateFieldbeatReportPdf } from "@/lib/fieldbeat-report-pdf";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PDF NEXUS (Phase 6): reutiliza EXACTAMENTE la misma consulta/forma que
// GET /api/dashboard/fieldbeat/reports/[id] (buildReportDetailQuery +
// runQueryWithoutJit + shapeReportDetail, ver ese route.ts) - nunca
// reimplementa la consulta ni la clasificación acá, solo cambia el
// formato de salida (PDF en vez de JSON).
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const { id } = await params;

  try {
    const fieldbeatTaskId = parseFieldbeatTaskId(id);
    const { sql, params: sqlParams } = buildReportDetailQuery(fieldbeatTaskId);
    const rows = await runQueryWithoutJit<Record<string, unknown>>(sql, sqlParams);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `No existe un reporte FieldBeat con ID ${fieldbeatTaskId}`, code: "NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const detail = shapeReportDetail(serializeRows(rows)[0] as never, isFieldbeatOpenConfigured());
    const pdfBuffer = await generateFieldbeatReportPdf(detail);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="nexus_fieldbeat_reporte_${fieldbeatTaskId}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
