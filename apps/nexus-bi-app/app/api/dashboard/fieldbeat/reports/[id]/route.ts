import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQueryWithoutJit, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildReportDetailQuery, collectReportContractVersionIds, fetchReportActiveIssues, parseFieldbeatTaskId, shapeReportDetail, type ReportDetailQueryRow } from "@/lib/fieldbeat-report-detail-queries";
import { fetchContractScheduleResultsByVersionIds } from "@/lib/explorer-sql";
import { isFieldbeatOpenConfigured } from "@/lib/fieldbeat-open-url";
import type { FieldbeatIssuesAvailability } from "@/types/fieldbeat-report-detail";

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

    // Sección 14 del encargo NEXUS V3 After-Hours - governance.issues solo
    // es legible por el rol de gobierno (pool distinto al genérico de
    // runQueryWithoutJit), así que nunca puede ir dentro del mismo SELECT.
    // Promise.allSettled (NUNCA Promise.all): una falla en la query de
    // incidencias no debe tumbar el detalle base del reporte - degrada a
    // "unavailable", nunca 500. Sigue siendo 1 sola request HTTP; ambas
    // queries corren en paralelo dentro de ella contra 2 pools distintos.
    const [detailResult, issuesResult] = await Promise.allSettled([
      // runQueryWithoutJit, no runQuery: ver el comentario en lib/db.ts -
      // esta consulta de 1 fila con varias correlated subqueries dispara
      // compilación JIT completa por el estimado pesimista del planner
      // (~1.7s de puro overhead de compilación, medido), sin ningún
      // beneficio real dado que solo procesa 1 fila.
      runQueryWithoutJit<Record<string, unknown>>(sql, sqlParams),
      fetchReportActiveIssues(fieldbeatTaskId)
    ]);

    if (detailResult.status === "rejected") throw detailResult.reason;
    const rows = detailResult.value;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `No existe un reporte FieldBeat con ID ${fieldbeatTaskId}`, code: "NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const issues: FieldbeatIssuesAvailability =
      issuesResult.status === "fulfilled" ? { status: "available", issues: issuesResult.value } : { status: "unavailable" };
    if (issuesResult.status === "rejected") {
      console.error("[fieldbeat-report-detail] fetchReportActiveIssues falló, detalle degrada a issues.status=unavailable:", issuesResult.reason);
    }

    // Horario de cobertura contractual (Bloque 2 NEXUS V3) - se recolectan
    // los contract_version_id de TODOS los equipos/contratos de este reporte
    // y se resuelven en UNA sola consulta batch (nunca una por contrato).
    // Aislado de shapeReportDetail (sigue una función pura de shaping) - un
    // fallo acá ya degrada a UNAVAILABLE por contrato dentro de
    // fetchContractScheduleResultsByVersionIds, así que nunca hace falta un
    // try/catch adicional en esta ruta.
    const serializedRow = serializeRows(rows)[0] as never as ReportDetailQueryRow;
    const scheduleByVersionId = await fetchContractScheduleResultsByVersionIds(collectReportContractVersionIds(serializedRow));

    const detail = shapeReportDetail(serializedRow, isFieldbeatOpenConfigured(), issues, scheduleByVersionId);
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
