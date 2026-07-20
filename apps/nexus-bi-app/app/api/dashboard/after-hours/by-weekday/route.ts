import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, groupedAggregateSelectSql, mapGroupedRow, type GroupedAggregateQueryRow } from "@/lib/after-hours-metrics";
import { padWeekdayRows } from "@/lib/after-hours-weekday-view";
import type { AfterHoursByDimensionRow, AfterHoursByWeekdayResponse } from "@/types/after-hours";

export const runtime = "nodejs";

// "¿Qué días concentran más actividad?" - distribución por día de la
// semana (ETAPA 6.6D). Agrupa por EXTRACT(ISODOW ...) (lunes=1..domingo=7,
// nunca el DOW nativo de Postgres que empieza en domingo=0) sobre la MISMA
// vista/población/tasa que el resto de los endpoints "by-X"
// (groupedAggregateSelectSql/mapGroupedRow, sin fórmulas duplicadas).
//
// Autoexclusión: ignora su propio filtro `weekday` (si el usuario ya
// seleccionó un día en este mismo gráfico, sigue mostrando los 7 días,
// nunca se auto-colapsa a 1 barra) - otros filtros sí se aplican.
//
// Padding: SIEMPRE 7 filas (lunes->domingo), incluso si algún día no tiene
// tareas - relleno en JS (padWeekdayRows), no generate_series, para no
// tener que hacer join-safe cada FILTER(...) de groupedAggregateSelectSql.
//
// aggregationUniverseTotal/tasksWithoutDate: mismo `conditionsSql` y
// `pusher.params` construidos UNA sola vez y reutilizados en las 3
// consultas (nunca se vuelve a invocar el builder) - ver invariante de
// reconciliación exacta: SUM(rows[].total_tasks) + tasksWithoutDate ===
// aggregationUniverseTotal (nunca comparado directo contra /summary
// mientras `weekday` esté activo, ya que este endpoint lo ignora a propósito).
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const filterConditions = buildAfterHoursMartConditions(filters, "w", pusher, ["weekday"]);

    const mainWhere = ["w.start_time_local IS NOT NULL", ...filterConditions].join(" AND ");
    const tasksWithoutDateWhere = ["w.start_time_local IS NULL", ...filterConditions].join(" AND ");
    const universeWhere = filterConditions.length > 0 ? filterConditions.join(" AND ") : "TRUE";

    const rows = await runQuery<GroupedAggregateQueryRow>(
      `
        SELECT
          EXTRACT(ISODOW FROM w.start_time_local)::int::text AS key,
          ${groupedAggregateSelectSql("w")}
        FROM ${AFTER_HOURS_VIEW} w
        WHERE ${mainWhere}
        GROUP BY 1
        ORDER BY 1
      `,
      pusher.params
    );

    const [tasksWithoutDateRow] = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${AFTER_HOURS_VIEW} w WHERE ${tasksWithoutDateWhere}`, pusher.params);
    const [universeRow] = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${AFTER_HOURS_VIEW} w WHERE ${universeWhere}`, pusher.params);

    const mapped: AfterHoursByDimensionRow[] = padWeekdayRows(rows.map(row => mapGroupedRow(row)));

    const response: AfterHoursByWeekdayResponse = {
      rows: mapped,
      tasksWithoutDate: Number(tasksWithoutDateRow.n),
      aggregationUniverseTotal: Number(universeRow.n)
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
