import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, groupedAggregateSelectSql, type AggregateMetricsRow } from "@/lib/after-hours-metrics";
import { mapWeekdayHourRow, padWeekdayHourCells } from "@/lib/after-hours-weekday-view";
import type { AfterHoursWeekdayHourCell, AfterHoursWeekdayHourResponse } from "@/types/after-hours";

export const runtime = "nodejs";

interface WeekdayHourRawRow extends AggregateMetricsRow {
  weekday: number;
  hour_of_day: number;
}

// "¿En qué días y horas se concentra?" - cruce día×hora para el heatmap
// (ETAPA 6.6D). Identidad compuesta (weekday, hour) seleccionada como dos
// columnas numéricas propias - NUNCA codificada en una key de texto
// concatenada que después haya que volver a separar. `weekday`/`hour_of_day`
// llegan como JS number nativo (oid int4 no está en el override de tipos
// de lib/db.ts, a diferencia de date/timestamp/timestamptz), sin necesidad
// de cast a texto.
//
// Autoexclusión: ignora sus propios filtros `weekday` Y `hour` (si el
// usuario ya seleccionó una celda de este mismo heatmap, sigue mostrando
// las 168 celdas completas) - otros filtros sí se aplican.
//
// Padding: SIEMPRE 168 celdas (7x24) vía padWeekdayHourCells, orden
// row-major fijo.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const filterConditions = buildAfterHoursMartConditions(filters, "w", pusher, ["weekday", "hour"]);

    const mainWhere = ["w.start_time_local IS NOT NULL", ...filterConditions].join(" AND ");
    const tasksWithoutDateWhere = ["w.start_time_local IS NULL", ...filterConditions].join(" AND ");
    const universeWhere = filterConditions.length > 0 ? filterConditions.join(" AND ") : "TRUE";

    const rows = await runQuery<WeekdayHourRawRow>(
      `
        SELECT
          EXTRACT(ISODOW FROM w.start_time_local)::int AS weekday,
          EXTRACT(HOUR FROM w.start_time_local)::int AS hour_of_day,
          ${groupedAggregateSelectSql("w")}
        FROM ${AFTER_HOURS_VIEW} w
        WHERE ${mainWhere}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
      pusher.params
    );

    const [tasksWithoutDateRow] = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${AFTER_HOURS_VIEW} w WHERE ${tasksWithoutDateWhere}`, pusher.params);
    const [universeRow] = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${AFTER_HOURS_VIEW} w WHERE ${universeWhere}`, pusher.params);

    const mapped: AfterHoursWeekdayHourCell[] = padWeekdayHourCells(rows.map(row => mapWeekdayHourRow(row)));

    const response: AfterHoursWeekdayHourResponse = {
      cells: mapped,
      tasksWithoutDate: Number(tasksWithoutDateRow.n),
      aggregationUniverseTotal: Number(universeRow.n)
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
