import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/duckdb";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import type { ConfidenceDistributionRow } from "@/types/after-hours";

const TIER_ORDER = ["Insuficiente", "Baja", "Media", "Alta"];

// Distribución Alta/Media/Baja/Insuficiente para el gráfico de confiabilidad
// de /dashboard/after-hours - ver docs/CALCULATION_CONFIDENCE_MODEL.md.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await runQuery<{ confidence_label: string; task_count: bigint }>(
      `
        SELECT w.confidence_label, COUNT(*) AS task_count
        FROM marts.fieldbeat_working_hours_analysis w
        ${whereClause}
        GROUP BY w.confidence_label
      `,
      pusher.params
    );

    const byLabel = new Map(rows.map(row => [row.confidence_label, Number(row.task_count)]));

    // Se devuelven las 4 categorías siempre (aunque tengan 0 tareas), en
    // orden fijo Insuficiente->Alta, mismo idioma que gold.fieldbeat_data_quality
    // (1 fila fija por cada valor posible de un status, aunque tenga 0 filas).
    const distribution: ConfidenceDistributionRow[] = TIER_ORDER.map(label => ({
      confidence_label: label,
      task_count: byLabel.get(label) ?? 0
    }));

    return NextResponse.json({ rows: distribution });
  } catch (error) {
    return handleApiError(error);
  }
}
