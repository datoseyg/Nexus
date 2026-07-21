import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { TICKET_ESTADO_ORDER } from "@/lib/dashboard-sql";
import type { SearchFiltersResponse } from "@/types/search";

export const runtime = "nodejs";

// Rutas auxiliares de /api/dashboard/operacional/filters fuera del alcance
// autorizado de esta etapa (no se modifica ese archivo) - se reimplementan
// acá las mismas consultas fijas, sin parámetros de usuario, sobre el
// mismo universo (marts.fieldbeat_report_dolibarr_operational_view /
// processed.zendesk_tickets). Duplicación sancionada explícitamente por el
// encargo, no un descuido.
export async function GET() {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const [clientesRows, tiposTareaRows, maquinasRows, martDateRows, zendeskDateRows] = await Promise.all([
      runQuery<{ client_name: string }>(`
        SELECT DISTINCT client_name FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE client_name IS NOT NULL AND client_name != '' ORDER BY client_name
      `),
      runQuery<{ task_type: string }>(`
        SELECT DISTINCT task_type FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE task_type IS NOT NULL AND task_type != '' ORDER BY task_type
      `),
      runQuery<{ equipo: string }>(`
        SELECT DISTINCT UPPER(TRIM(UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')))) AS equipo
        FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE equipment_internal_ids IS NOT NULL AND equipment_internal_ids != '' ORDER BY equipo
      `),
      runQuery<{ mn: string; mx: string }>(`
        SELECT CAST(MIN(fieldbeat_task_date) AS VARCHAR) AS mn, CAST(MAX(fieldbeat_task_date) AS VARCHAR) AS mx
        FROM marts.fieldbeat_report_dolibarr_operational_view WHERE fieldbeat_task_date IS NOT NULL
      `),
      runQuery<{ mn: string; mx: string }>(`
        SELECT CAST(MIN(created_at) AS VARCHAR) AS mn, CAST(MAX(created_at) AS VARCHAR) AS mx
        FROM processed.zendesk_tickets WHERE created_at IS NOT NULL
      `)
    ]);

    const martMin = martDateRows[0]?.mn?.slice(0, 10) ?? null;
    const martMax = martDateRows[0]?.mx?.slice(0, 10) ?? null;
    const zendeskMin = zendeskDateRows[0]?.mn?.slice(0, 10) ?? null;
    const zendeskMax = zendeskDateRows[0]?.mx?.slice(0, 10) ?? null;

    const mins = [martMin, zendeskMin].filter((v): v is string => Boolean(v));
    const maxs = [martMax, zendeskMax].filter((v): v is string => Boolean(v));

    const response: SearchFiltersResponse = {
      dateRange: {
        min: mins.length ? mins.reduce((a, b) => (a < b ? a : b)) : null,
        max: maxs.length ? maxs.reduce((a, b) => (a > b ? a : b)) : null
      },
      clientes: clientesRows.map(r => r.client_name),
      maquinas: maquinasRows.map(r => r.equipo),
      tiposTarea: tiposTareaRows.map(r => r.task_type),
      estadosTicket: [...TICKET_ESTADO_ORDER]
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
