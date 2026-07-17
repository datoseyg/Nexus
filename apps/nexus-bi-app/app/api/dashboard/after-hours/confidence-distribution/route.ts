import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW } from "@/lib/after-hours-metrics";
import type { ConfidenceDistributionResponse } from "@/types/after-hours";

export const runtime = "nodejs";

const TIER_ORDER = ["Insuficiente", "Baja", "Media", "Alta"];

// Distribución Alta/Media/Baja/Insuficiente para el gráfico de confiabilidad
// de /dashboard/after-hours - ver docs/CALCULATION_CONFIDENCE_MODEL.md.
// ETAPA 6.6C: fuente marts.fieldbeat_working_hours_analysis_current.
//
// §10: confidence_score y contract_resolution_confidence son ESCALAS
// DISTINTAS (miden cosas distintas: calidad del intervalo vs. confianza de
// la resolución contractual) - nunca se mezclan en una sola distribución.
// contractResolutionDistribution es aditiva, exclusiva de data_basis=
// CONTRACTUAL, en su propia serie. Filas NONE sin score (confidence_label
// IS NULL, el caso de intervalo terminal - INVALID_START_TIME/
// INVALID_DURATION/INSUFFICIENT_DATA) se reportan en noneWithoutScore,
// nunca vuelcan silenciosamente a "Insuficiente" (antes de 6.6C esas filas
// simplemente desaparecían del conteo, ya que GROUP BY agrupaba su NULL
// aparte y TIER_ORDER.map() nunca leía esa clave).
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const conditions = buildAfterHoursMartConditions(filters, "w", pusher);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [tierRows, noneWithoutScoreRows, contractResolutionRows] = await Promise.all([
      runQuery<{ confidence_label: string; task_count: string }>(
        `
          SELECT w.confidence_label, COUNT(*) AS task_count
          FROM ${AFTER_HOURS_VIEW} w
          ${whereClause ? `${whereClause} AND w.confidence_label IS NOT NULL` : "WHERE w.confidence_label IS NOT NULL"}
          GROUP BY w.confidence_label
        `,
        pusher.params
      ),
      // Acotado a data_basis='NONE' explícitamente (§10: "filas NONE sin
      // score") - una fila NO NONE con confidence_label NULL sería un
      // caso distinto (relleno transitorio del mart legado, ver sql/082;
      // no debería ocurrir para CONTRACTUAL/LEGACY_SCHEDULE bajo el
      // pipeline nuevo, que siempre computa confianza). Esa fila igual
      // queda excluida de los 4 tiers (el filtro de arriba ya la saca por
      // ser NULL), simplemente no se cuenta acá bajo "NONE sin score"
      // porque no lo es.
      runQuery<{ task_count: string }>(
        `
          SELECT COUNT(*) AS task_count
          FROM ${AFTER_HOURS_VIEW} w
          ${whereClause ? `${whereClause} AND` : "WHERE"} w.confidence_label IS NULL AND w.data_basis = 'NONE'
        `,
        pusher.params
      ),
      runQuery<{ contract_resolution_label: string; task_count: string }>(
        `
          SELECT w.contract_resolution_label, COUNT(*) AS task_count
          FROM ${AFTER_HOURS_VIEW} w
          ${whereClause ? `${whereClause} AND w.data_basis = 'CONTRACTUAL'` : "WHERE w.data_basis = 'CONTRACTUAL'"}
          GROUP BY w.contract_resolution_label
        `,
        pusher.params
      )
    ]);

    const byLabel = new Map(tierRows.map(row => [row.confidence_label, Number(row.task_count)]));

    // Se devuelven las 4 categorías siempre (aunque tengan 0 tareas), en
    // orden fijo Insuficiente->Alta, mismo idioma que gold.fieldbeat_data_quality
    // (1 fila fija por cada valor posible de un status, aunque tenga 0 filas).
    const response: ConfidenceDistributionResponse = {
      rows: TIER_ORDER.map(label => ({ confidence_label: label, task_count: byLabel.get(label) ?? 0 })),
      noneWithoutScore: Number(noneWithoutScoreRows[0]?.task_count ?? 0),
      contractResolutionDistribution: contractResolutionRows
        .filter(row => row.contract_resolution_label !== null)
        .map(row => ({ contract_resolution_label: row.contract_resolution_label, task_count: Number(row.task_count) }))
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
