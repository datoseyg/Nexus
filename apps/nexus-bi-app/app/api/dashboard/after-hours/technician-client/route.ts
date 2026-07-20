import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { buildAfterHoursMartConditions, createParamPusher, parseAfterHoursFilters } from "@/lib/after-hours-filters";
import { AFTER_HOURS_VIEW, groupedAggregateSelectSql, mapGroupedRow, type GroupedAggregateQueryRow } from "@/lib/after-hours-metrics";
import type { AfterHoursByDimensionRow, AfterHoursTechnicianClientResponse } from "@/types/after-hours";

export const runtime = "nodejs";

// Expresión reutilizada 3 veces (SELECT/GROUP BY/WHERE/ORDER BY): trata un
// técnico o cliente compuesto solo por espacios IGUAL que NULL, nunca como
// una identidad real distinta ("   " no es un técnico llamado "espacio").
// BTRIM (no TRIM(BOTH) simple) recorta explícitamente ambos extremos;
// NULLIF colapsa el resultado vacío a NULL para que IS NULL/IS NOT NULL
// funcionen igual que con la columna cruda.
const TECHNICIAN_KEY_SQL = "NULLIF(BTRIM(w.assigned_to), '')";
const CLIENT_KEY_SQL = "NULLIF(BTRIM(w.client_name), '')";

// "¿Cómo se relacionan técnicos y clientes?" - ranking de pares
// técnico×cliente (ETAPA 6.6D), no una matriz 2D (decisión de diseño:
// evita una grilla dispersa de hasta N técnicos x M clientes, ilegible y
// difícil de accesibilizar). Reutiliza mapGroupedRow SIN cambios (key =
// técnico, extra = cliente - mismo patrón que by-client con
// key=cliente/extra=rut, roles invertidos).
//
// Autoexclusión: ignora sus propios filtros `technician` Y `client` (si el
// usuario ya seleccionó un par de este mismo ranking, sigue mostrando
// todos los pares) - otros filtros sí se aplican.
//
// NULL/vacío: un técnico y/o cliente ausente (o solo espacios) NUNCA
// aparece dentro de `rows` ni se pierde silenciosamente - se cuenta
// exactamente una vez en `excludedTasks`, mutuamente excluyente con `rows`
// por construcción de la propia condición WHERE de la consulta principal.
//
// Orden determinista: after_hours_minutes DESC con desempate estable por
// técnico/cliente (ASC) - dos pares con métrica idéntica nunca quedan en
// un orden dependiente del plan de ejecución de Postgres.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = parseAfterHoursFilters(searchParams);

    const pusher = createParamPusher();
    const filterConditions = buildAfterHoursMartConditions(filters, "w", pusher, ["tecnico", "cliente"]);

    const presentGuard = `${TECHNICIAN_KEY_SQL} IS NOT NULL AND ${CLIENT_KEY_SQL} IS NOT NULL`;
    const absentGuard = `(${TECHNICIAN_KEY_SQL} IS NULL OR ${CLIENT_KEY_SQL} IS NULL)`;

    const mainWhere = [presentGuard, ...filterConditions].join(" AND ");
    const excludedWhere = [absentGuard, ...filterConditions].join(" AND ");
    const universeWhere = filterConditions.length > 0 ? filterConditions.join(" AND ") : "TRUE";

    const rows = await runQuery<GroupedAggregateQueryRow>(
      `
        SELECT
          ${TECHNICIAN_KEY_SQL} AS key,
          ${CLIENT_KEY_SQL} AS extra,
          ${groupedAggregateSelectSql("w")}
        FROM ${AFTER_HOURS_VIEW} w
        WHERE ${mainWhere}
        GROUP BY ${TECHNICIAN_KEY_SQL}, ${CLIENT_KEY_SQL}
        ORDER BY after_hours_minutes DESC NULLS LAST, ${TECHNICIAN_KEY_SQL} ASC, ${CLIENT_KEY_SQL} ASC
      `,
      pusher.params
    );

    const [excludedRow] = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${AFTER_HOURS_VIEW} w WHERE ${excludedWhere}`, pusher.params);
    const [universeRow] = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${AFTER_HOURS_VIEW} w WHERE ${universeWhere}`, pusher.params);

    const mapped: AfterHoursByDimensionRow[] = rows.map(row => mapGroupedRow(row));

    const response: AfterHoursTechnicianClientResponse = {
      rows: mapped,
      excludedTasks: Number(excludedRow.n),
      aggregationUniverseTotal: Number(universeRow.n)
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
