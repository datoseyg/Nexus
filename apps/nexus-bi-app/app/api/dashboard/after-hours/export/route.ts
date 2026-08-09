import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser, NexusAuthorizationError } from "@/lib/auth/authorization";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { runGovernanceQuery } from "@/lib/governance-db";
import { escapeCsvCell } from "@/lib/csv-export";
import { MAX_EXPORT_ROWS } from "@/lib/fieldbeat-reports-queries";
import { buildAfterHoursMartConditions, buildReportIdCondition, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW } from "@/lib/after-hours-metrics";
import { splitDateTime, totalAfterHoursHours } from "@/lib/after-hours-detail-view";
import { getDataBasisLabel, getCoverageClassificationLabel, buildDiagnosis } from "@/lib/after-hours-labels";
import type { AfterHoursCoverageReasonCode, AfterHoursDataBasis } from "@/types/after-hours";

export const runtime = "nodejs";

// Exportación CSV de "Registros detectados fuera de horario"
// (AfterHoursDetailTable.tsx en /dashboard/after-hours). MISMA fuente,
// MISMOS filtros y MISMA semántica que /api/dashboard/after-hours/detail
// (AFTER_HOURS_VIEW + parseAfterHoursFilters + buildAfterHoursMartConditions
// + buildReportIdCondition, todas importadas de lib/after-hours-filters.ts,
// nunca reimplementadas acá) - nunca pagina: universo filtrado completo hasta
// MAX_EXPORT_ROWS (mismo tope defensivo que Reportes FieldBeat/Auditoría,
// lib/fieldbeat-reports-queries.ts), rechazado con 413 si lo supera en vez
// de truncar en silencio.
//
// Ruta: se pidió /api/dashboard/fieldbeat/after-hours/export, pero la
// convención real del repo no anida "fieldbeat" bajo "after-hours" (son
// namespaces HERMANOS bajo /api/dashboard/, ver los otros 9 route.ts de
// after-hours/*) - esta ruta sigue el mismo patrón que
// /api/dashboard/fieldbeat/reports/export (export como subruta de la propia
// entidad).
//
// Auditoría (Gate B Familia 7): reutiliza governance.fn_record_export_completed
// TAL CUAL (misma función/tabla que Auditoría/Explorador, "la política
// existente para eventos obligatorios" - nunca se crea una migración nueva
// para esto). El event_type queda fijo en 'EXPORT_COMPLETED' (así está
// definida la función, no es parametrizable) - el discriminador lógico
// "AFTER_HOURS_CSV_EXPORTED" pedido por el encargo se recupera vía
// entityType='after-hours-detail' dentro de after_state (mismo patrón que
// entityType='audit-issues'/'explorer-issues' ya usan los otros 3
// exportadores). Consulta de verificación:
//   SELECT * FROM governance.command_events
//   WHERE event_type = 'EXPORT_COMPLETED' AND after_state->>'entityType' = 'after-hours-detail';
// requestId (pedido por el encargo, sin columna dedicada en la función
// existente) viaja dentro de filtersSummary.requestId - jsonb ya es flexible,
// no requiere tocar el esquema. El insert de auditoría se hace ANTES de
// construir la respuesta CSV y comparte el mismo try/catch que el resto del
// handler: si fn_record_export_completed falla, handleApiError responde con
// error y el CSV NUNCA se entrega sin trazabilidad (mismo orden que usan
// audit/issues/export y audit/review-cases/export).
const CSV_COLUMNS: Array<{ header: string; pick: (row: ExportRow) => unknown }> = [
  { header: "ID de tarea", pick: r => r.fieldbeat_task_id },
  { header: "Fecha", pick: r => splitDateTime(r.start_time_local).date },
  { header: "Hora de inicio", pick: r => splitDateTime(r.start_time_local).time },
  { header: "Hora de término", pick: r => splitDateTime(r.end_time_local).time },
  { header: "Técnico o responsable", pick: r => r.assigned_to ?? "" },
  { header: "Cliente", pick: r => r.client_name ?? "" },
  { header: "Equipo", pick: r => r.equipment_internal_ids ?? "" },
  { header: "Tipo de tarea", pick: r => r.task_type ?? "" },
  { header: "Horario contractual", pick: r => getDataBasisLabel(r.data_basis).label },
  {
    header: "Minutos fuera de horario",
    pick: r => {
      const hours = totalAfterHoursHours({
        business_hours: r.business_minutes !== null ? Number(r.business_minutes) / 60 : null,
        after_hours: r.after_hours_weekday_minutes !== null ? Number(r.after_hours_weekday_minutes) / 60 : null,
        weekend_hours: r.weekend_minutes !== null ? Number(r.weekend_minutes) / 60 : null,
        holiday_hours: r.holiday_minutes !== null ? Number(r.holiday_minutes) / 60 : null
      });
      return hours === null ? "" : Math.round(hours * 60);
    }
  },
  { header: "Clasificación", pick: r => getCoverageClassificationLabel(r.coverage_classification).label },
  {
    header: "Motivo o regla aplicada",
    pick: r => {
      const diagnosis = buildDiagnosis({
        dataBasis: r.data_basis,
        fallbackUsed: r.fallback_used,
        coverageReasonCode: r.coverage_reason_code,
        contractualReasonCode: r.contractual_reason_code
      });
      return diagnosis.secondary ? `${diagnosis.primary.label} — ${diagnosis.secondary}` : diagnosis.primary.label;
    }
  }
];

interface ExportRow {
  fieldbeat_task_id: number;
  start_time_local: string | null;
  end_time_local: string | null;
  client_name: string | null;
  equipment_internal_ids: string | null;
  assigned_to: string | null;
  task_type: string | null;
  data_basis: AfterHoursDataBasis;
  coverage_classification: string | null;
  coverage_reason_code: AfterHoursCoverageReasonCode | null;
  contractual_reason_code: AfterHoursCoverageReasonCode | null;
  fallback_used: boolean | null;
  business_minutes: string | number | null;
  after_hours_weekday_minutes: string | number | null;
  weekend_minutes: string | number | null;
  holiday_minutes: string | number | null;
}

function csvRow(row: ExportRow): string {
  return CSV_COLUMNS.map(c => escapeCsvCell(c.pick(row))).join(",") + "\r\n";
}

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401 ? { error: "Unauthorized", code: "UNAUTHORIZED" } : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  const requestId = randomUUID();

  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);

    const reportIdRaw = searchParams.get("reportId");
    const reportIdResult = buildReportIdCondition(reportIdRaw, "w", pusher);
    if (reportIdResult && "errorMessage" in reportIdResult) {
      return NextResponse.json({ error: reportIdResult.errorMessage }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }
    if (reportIdResult && "condition" in reportIdResult) {
      conditions.push(reportIdResult.condition);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitPlaceholder = `$${pusher.params.length + 1}`;

    const rawRows = await runQuery<ExportRow & { total_count: string }>(
      `
        SELECT
          w.fieldbeat_task_id,
          w.start_time_local,
          w.end_time_local,
          w.client_name,
          w.equipment_internal_ids,
          w.assigned_to,
          w.task_type,
          w.data_basis,
          w.coverage_classification,
          w.coverage_reason_code,
          w.contractual_reason_code,
          w.fallback_used,
          w.business_minutes,
          w.after_hours_weekday_minutes,
          w.weekend_minutes,
          w.holiday_minutes,
          COUNT(*) OVER() AS total_count
        FROM ${AFTER_HOURS_VIEW} w
        ${whereClause}
        ORDER BY w.start_time_local DESC NULLS LAST
        LIMIT ${limitPlaceholder}
      `,
      [...pusher.params, MAX_EXPORT_ROWS]
    );

    const trueTotalRows = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;

    // Sin registros: nunca se entrega un CSV (ni siquiera solo-encabezados)
    // presentado como si fuera un resultado - JSON explícito, Content-Type
    // distinto de text/csv, para que el cliente NUNCA dispare una descarga
    // (ver AfterHoursDetailTable.tsx::handleExport, que chequea Content-Type
    // antes de tratar la respuesta como blob). No se registra evento de
    // auditoría: no se produjo ningún archivo que auditar.
    if (trueTotalRows === 0) {
      console.info(`[after-hours-export] requestId=${requestId} rows=0 totalRows=0`);
      return NextResponse.json(
        { error: "No hay registros para exportar con los filtros aplicados.", code: "EXPORT_EMPTY_RESULT", totalRows: 0 },
        { status: 200, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    if (trueTotalRows > MAX_EXPORT_ROWS) {
      console.info(`[after-hours-export] requestId=${requestId} rejected=true totalRows=${trueTotalRows} maxExportRows=${MAX_EXPORT_ROWS}`);
      return NextResponse.json(
        {
          error: `La exportación supera el límite de ${MAX_EXPORT_ROWS.toLocaleString("es-CL")} filas (universo filtrado: ${trueTotalRows.toLocaleString("es-CL")} registros). Acota los filtros antes de exportar.`,
          code: "EXPORT_LIMIT_EXCEEDED",
          totalRows: trueTotalRows,
          maxExportRows: MAX_EXPORT_ROWS
        },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Nunca loguea contenido de filas (clientes/técnicos) - solo el conteo,
    // mismo principio que el resto de los exportadores de la app.
    console.info(`[after-hours-export] requestId=${requestId} rows=${rawRows.length} totalRows=${trueTotalRows}`);

    // Auditoría append-only ANTES de construir la respuesta CSV (Gate B
    // Familia 7): si esto falla, el catch de abajo responde con error y el
    // CSV nunca se entrega sin trazabilidad.
    await runGovernanceQuery(
      "app_read",
      "SELECT governance.fn_record_export_completed($1::uuid, $2, $3, $4::jsonb, $5::integer, $6)",
      [
        user.id,
        user.role,
        "after-hours-detail",
        JSON.stringify({ ...filters, reportId: reportIdRaw ?? undefined, requestId }),
        rawRows.length,
        "csv"
      ]
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // BOM UTF-8 (compatibilidad Excel) - primer chunk, antes del
        // encabezado. Escape explicito \uFEFF (nunca el carácter literal en
        // el fuente): evita que un editor/herramienta normalice o corrompa
        // en silencio un carácter invisible dentro del código.
        controller.enqueue(encoder.encode("\uFEFF"));
        controller.enqueue(encoder.encode(CSV_COLUMNS.map(c => escapeCsvCell(c.header)).join(",") + "\r\n"));
        for (const row of rawRows) {
          controller.enqueue(encoder.encode(csvRow(row)));
        }
        controller.close();
      }
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `nexus_fuera_de_horario_${today}.csv`;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
