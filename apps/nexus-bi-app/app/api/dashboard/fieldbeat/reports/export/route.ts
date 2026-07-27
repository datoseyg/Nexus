import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { escapeCsvCell } from "@/lib/csv-export";
import { parseFieldbeatQualityFilters } from "@/lib/fieldbeat-quality-filters";
import {
  MAX_EXPORT_ROWS,
  buildReportsExportQuery,
  isExportOverLimit,
  parseReportsDirection,
  parseReportsSearch,
  parseReportsSort,
  parseReportsView,
  shapeReportRow
} from "@/lib/fieldbeat-reports-queries";
import type { FieldbeatReportRow } from "@/types/fieldbeat-reports";

export const runtime = "nodejs";

const CSV_COLUMNS: Array<{ header: string; pick: (row: FieldbeatReportRow) => unknown }> = [
  { header: "id_reporte", pick: r => r.fieldbeatTaskId },
  { header: "fecha", pick: r => r.fecha },
  { header: "cliente", pick: r => r.cliente },
  { header: "tecnico", pick: r => r.tecnico },
  // Aditiva (HOTFIX de integridad de datos, Stage 10) - NUNCA reemplaza a
  // "tecnico" (responsable principal); participantes adicionales
  // (quality.fieldbeat_report_participants, is_primary=false).
  { header: "tecnicos_adicionales", pick: r => r.additionalParticipants.join("; ") },
  { header: "equipo", pick: r => r.equipo },
  { header: "tipo_tarea", pick: r => r.tipoTarea },
  { header: "origen", pick: r => r.origen },
  { header: "estado_calidad", pick: r => r.reportQualityStatus },
  { header: "severidad_principal", pick: r => r.primary?.severity ?? "" },
  { header: "codigo_principal", pick: r => r.primary?.code ?? "" },
  { header: "hallazgos_secundarios", pick: r => r.findings.filter(f => f.code !== r.primary?.code).map(f => f.code).join("; ") },
  { header: "ticket_informado", pick: r => (r.hasTicketReported ? "si" : "no") },
  { header: "ticket_accesible", pick: r => (r.ticketAccessible === null ? "" : r.ticketAccessible ? "si" : "no") }
];

function csvRow(row: FieldbeatReportRow): string {
  return CSV_COLUMNS.map(c => escapeCsvCell(c.pick(row))).join(",") + "\r\n";
}

// Export CSV de la bandeja de Reportes (Phase 4 §11) - respeta view/
// filtros/búsqueda vigentes (misma consulta base que el listado paginado,
// ver lib/fieldbeat-reports-queries.ts), pero SIN paginar: universo
// filtrado completo hasta MAX_EXPORT_ROWS (tope defensivo fijo, nunca
// "todo sin límite"). Streaming real hacia la respuesta HTTP (ReadableStream,
// nunca un string gigante concatenado en memoria antes de responder) -
// dolibarr/postgres ya acotó el trabajo pesado vía MAX_EXPORT_ROWS, así que
// el costo de mantener esto en memoria como array de filas ya es acotado;
// lo que se evita acá es construir un string de varios MB en un solo paso.
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
  const sort = parseReportsSort(searchParams.get("sort"));
  const direction = parseReportsDirection(searchParams.get("direction"));
  const search = parseReportsSearch(searchParams.get("search"));

  try {
    const { sql, params } = buildReportsExportQuery({ filters, view, search, sort, direction });
    const rawRows = await runQuery<Record<string, unknown> & { total_count: string }>(sql, params);

    // Phase 5 preflight §2.3 - COUNT(*) OVER() refleja el universo filtrado
    // COMPLETO (evaluado antes del LIMIT MAX_EXPORT_ROWS de
    // buildReportsExportQuery, semántica estándar de SQL) - así que ya
    // sabemos el total real sin una segunda consulta. Si excede el límite,
    // se rechaza explícitamente (413) en vez de entregar un CSV truncado
    // presentado como completo - nunca trunca en silencio.
    const trueTotalRows = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;
    if (isExportOverLimit(trueTotalRows)) {
      console.info(`[fieldbeat-reports-export] view=${view} rejected=true totalRows=${trueTotalRows} maxExportRows=${MAX_EXPORT_ROWS}`);
      return NextResponse.json(
        {
          error: `La exportación supera el límite de ${MAX_EXPORT_ROWS.toLocaleString("es-CL")} filas (universo filtrado: ${trueTotalRows.toLocaleString("es-CL")} reportes). Acota los filtros antes de exportar.`,
          code: "EXPORT_LIMIT_EXCEEDED",
          totalRows: trueTotalRows,
          maxExportRows: MAX_EXPORT_ROWS
        },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const rows = serializeRows(rawRows).map(row => shapeReportRow(row as never));

    // Nunca loguea contenido de filas (datos de clientes/técnicos) - solo el
    // conteo, mismo principio que los logs de auditoría manual.
    console.info(`[fieldbeat-reports-export] view=${view} rows=${rows.length} totalRows=${trueTotalRows}`);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(CSV_COLUMNS.map(c => c.header).join(",") + "\r\n"));
        for (const row of rows) {
          controller.enqueue(encoder.encode(csvRow(row)));
        }
        controller.close();
      }
    });

    // Nombre determinístico (view + fecha del día, sin UUID/timestamp de
    // segundos) - re-exportar el mismo día produce el mismo nombre de archivo.
    const today = new Date().toISOString().slice(0, 10);
    const filename = `fieldbeat-reportes-${view}-${today}.csv`;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
