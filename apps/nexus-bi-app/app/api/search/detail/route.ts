import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { parseDetailParams } from "@/lib/search-filters";
import {
  assertNumericIdFormat,
  buildClientDetailRelatedQuery,
  buildClientDetailSummaryQuery,
  buildMachineDetailRelatedQuery,
  buildMachineDetailSummaryQuery,
  buildPartDetailRelatedQuery,
  buildPartDetailSummaryQuery,
  buildTicketDetailRelatedQuery,
  buildTicketDetailSummaryQuery,
  mapClientRow,
  mapMachineRow,
  mapPartRow,
  mapReportRow,
  mapTicketRow,
  parsePartsKey,
  toSafeCount
} from "@/lib/search-sql";
import type { SearchDetailResponse, SearchReportResult } from "@/types/search";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "No encontrado", code: "NOT_FOUND" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const { entity, key } = parseDetailParams(request.nextUrl.searchParams);

    if (entity === "clients") {
      const summaryQuery = buildClientDetailSummaryQuery(key);
      const summaryRows = await runQuery<Record<string, unknown>>(summaryQuery.sql, summaryQuery.params);
      if (summaryRows.length === 0) return notFound();
      const relatedQuery = buildClientDetailRelatedQuery(key);
      const relatedRows = await runQuery<{ recent_reports: unknown[]; machines: unknown[]; tickets: unknown[] }>(
        relatedQuery.sql,
        relatedQuery.params
      );
      const related = relatedRows[0];
      const response: SearchDetailResponse = {
        entity: "clients",
        summary: mapClientRow(serializeRows(summaryRows)[0]),
        recentReports: (related?.recent_reports ?? []).map(r => mapReportRow(r as Record<string, unknown>)),
        machines: ((related?.machines ?? []) as Array<Record<string, unknown>>).map(m => ({
          key: String(m.machine_id),
          machineId: String(m.machine_id),
          clientName: null,
          reportCount: toSafeCount(m.report_count),
          ticketCount: toSafeCount(m.ticket_count)
        })),
        tickets: (related?.tickets ?? []).map(t => mapTicketRow(t as Record<string, unknown>))
      };
      return NextResponse.json(response);
    }

    if (entity === "machines") {
      const summaryQuery = buildMachineDetailSummaryQuery(key);
      const summaryRows = await runQuery<Record<string, unknown>>(summaryQuery.sql, summaryQuery.params);
      if (summaryRows.length === 0) return notFound();
      const relatedQuery = buildMachineDetailRelatedQuery(key);
      const relatedRows = await runQuery<{ recent_reports: unknown[] }>(relatedQuery.sql, relatedQuery.params);
      const response: SearchDetailResponse = {
        entity: "machines",
        summary: mapMachineRow(serializeRows(summaryRows)[0]),
        recentReports: (relatedRows[0]?.recent_reports ?? []).map(r => mapReportRow(r as Record<string, unknown>))
      };
      return NextResponse.json(response);
    }

    // HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - entity
    // "reports" eliminado: Search ya nunca solicita este detalle (el click en
    // un resultado de reportes abre directo el drawer canónico vía
    // fieldbeatTaskId, ver SearchDashboard.tsx) - buildReportDetailSummaryQuery/
    // buildReportDetailRelatedQuery retirados junto con esta rama. Rechazo
    // EXPLÍCITO (nunca cae silenciosamente al catch-all de "parts" de más
    // abajo - "reports" sigue siendo un SearchEntity válido para otros usos,
    // ver types/search.ts, así que parseDetailParams no lo bloquea solo).
    if (entity === "reports") {
      return NextResponse.json({ error: "El detalle de reportes ya no se sirve acá - usa el drawer canónico.", code: "ENTITY_RETIRED" }, { status: 400 });
    }

    if (entity === "tickets") {
      assertNumericIdFormat(key, "ticketId");
      const summaryQuery = buildTicketDetailSummaryQuery(key);
      const summaryRows = await runQuery<Record<string, unknown>>(summaryQuery.sql, summaryQuery.params);
      if (summaryRows.length === 0) return notFound();
      const relatedQuery = buildTicketDetailRelatedQuery(key);
      const relatedRows = await runQuery<{ linked_reports: unknown[] }>(relatedQuery.sql, relatedQuery.params);
      const response: SearchDetailResponse = {
        entity: "tickets",
        summary: mapTicketRow(serializeRows(summaryRows)[0]),
        linkedReports: (relatedRows[0]?.linked_reports ?? []).map(r => mapReportRow(r as Record<string, unknown>))
      };
      return NextResponse.json(response);
    }

    // parts
    const partsKey = parsePartsKey(key);
    const summaryQuery = buildPartDetailSummaryQuery(partsKey);
    const summaryRows = await runQuery<Record<string, unknown>>(summaryQuery.sql, summaryQuery.params);
    // HOTFIX de integridad de datos FieldBeat (Stage 9) - "no encontrado" se
    // detecta por used_part_id (SIEMPRE presente cuando alguna fila real
    // matcheó, ver MAX(m.used_part_id) en buildPartDetailSummaryQuery), NUNCA
    // por dolibarr_ref/raw_part_identifier ambos nulos - un repuesto sin
    // código real (identidad raw-occurrence:<used_part_id>) es un caso
    // VÁLIDO donde ambos son legítimamente null, no "no encontrado". La
    // consulta es un agregado sin GROUP BY - summaryRows.length siempre es 1
    // (MAX/SUM/COUNT sobre cero filas devuelve NULL/0), por eso el chequeo
    // real es sobre el contenido, no sobre el largo del array.
    if (summaryRows.length === 0 || summaryRows[0].used_part_id == null) return notFound();
    const relatedQuery = buildPartDetailRelatedQuery(partsKey);
    const relatedRows = await runQuery<{ recent_usages: unknown[] }>(relatedQuery.sql, relatedQuery.params);
    // No se reutiliza mapReportRow() acá: la subconsulta de usos recientes
    // solo trae fieldbeat_task_id/fecha/cliente/quantity (no
    // used_parts_count del reporte completo, no task_type, no ticket) -
    // mapReportRow() calcularía hasParts=false por defecto (campo
    // ausente), lo cual sería falso: por construcción, cada fila de esta
    // lista SÍ representa un uso real de este repuesto.
    const recentUsages: SearchReportResult[] = ((relatedRows[0]?.recent_usages ?? []) as Array<Record<string, unknown>>).map(row => ({
      key: String(row.fieldbeat_task_id),
      fieldbeatTaskId: String(row.fieldbeat_task_id),
      date: (row.fieldbeat_task_date as string | null) ?? null,
      clientName: (row.client_name as string | null) ?? null,
      machineId: null,
      taskType: null,
      ticketId: null,
      snippet: null,
      hasParts: true
    }));
    const response: SearchDetailResponse = {
      entity: "parts",
      summary: mapPartRow(serializeRows(summaryRows)[0]),
      recentUsages
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
