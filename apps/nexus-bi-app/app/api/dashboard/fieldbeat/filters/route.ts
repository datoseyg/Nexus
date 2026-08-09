import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextResponse } from "next/server";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { KNOWN_REPORT_QUALITY_STATUSES } from "@/types/fieldbeat";
import { INCONSISTENCY_TAXONOMY } from "@/lib/fieldbeat-inconsistency-taxonomy";

export const runtime = "nodejs";

// ETAPA 6 - alimenta la barra de filtros de /dashboard/fieldbeat, hasta
// ahora deshabilitada por diseño (ver FieldbeatDisabledFilters.tsx,
// ETAPA 5-V: "el backend no acepta ningún parámetro"). Fuente: MISMA tabla
// que ya usa /api/dashboard/operacional/filters
// (marts.fieldbeat_report_dolibarr_operational_view, 3.747 filas = 1:1 con
// processed.fieldbeat_tasks) + processed.fieldbeat_tasks.created_in para
// "origen" real (APK/WEB) - nunca la heurística Apoteca/General de
// Operacional, que mide un eje distinto (tipo de cliente, no canal de
// captura) y no aplica acá.
//
// Phase 2 - se agregan campos ADITIVOS para la barra de filtros de
// Calidad/Cruces/Reportes (tecnicos + los 4 allowlists estáticos de
// lib/fieldbeat-quality-filters.ts) - nunca se quitó ni renombró un campo
// existente, así que /dashboard/fieldbeat (el dashboard viejo) sigue
// funcionando sin cambios.
const TICKET_STATUSES = ["accessible", "missing_or_restricted", "none"] as const;
const PART_STATUSES = ["fully_traceable", "contains_placeholder", "contains_no_match", "contains_ambiguous"] as const;
const SEVERITIES = ["Alta", "Media", "Baja", "Advertencia"] as const;

export async function GET() {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const [clientesRows, tiposTareaRows, equiposRows, origenesRows, tecnicosRows, dateRangeRows] = await Promise.all([
      runQuery<{ v: string }>(`
        SELECT DISTINCT client_name AS v
        FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE client_name IS NOT NULL AND client_name != ''
        ORDER BY v
      `),
      runQuery<{ v: string }>(`
        SELECT DISTINCT task_type AS v
        FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE task_type IS NOT NULL AND task_type != ''
        ORDER BY v
      `),
      runQuery<{ v: string }>(`
        SELECT DISTINCT UNNEST(STRING_TO_ARRAY(equipment_internal_ids, '|')) AS v
        FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE equipment_internal_ids IS NOT NULL AND equipment_internal_ids != ''
        ORDER BY v
      `),
      runQuery<{ v: string }>(`
        SELECT DISTINCT created_in AS v
        FROM processed.fieldbeat_tasks
        WHERE created_in IS NOT NULL AND created_in != ''
        ORDER BY v
      `),
      runQuery<{ v: string }>(`
        SELECT DISTINCT technician_names AS v
        FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE technician_names IS NOT NULL AND technician_names != ''
        ORDER BY v
      `),
      runQuery<{ mn: string; mx: string }>(`
        SELECT CAST(MIN(fieldbeat_task_date) AS VARCHAR) AS mn, CAST(MAX(fieldbeat_task_date) AS VARCHAR) AS mx
        FROM marts.fieldbeat_report_dolibarr_operational_view
        WHERE fieldbeat_task_date IS NOT NULL
      `)
    ]);

    return NextResponse.json({
      clientes: clientesRows.map(r => r.v),
      tiposTarea: tiposTareaRows.map(r => r.v),
      equipos: equiposRows.map(r => r.v),
      origenes: origenesRows.map(r => r.v),
      dateRange: {
        min: dateRangeRows[0]?.mn?.slice(0, 10) ?? null,
        max: dateRangeRows[0]?.mx?.slice(0, 10) ?? null
      },
      tecnicos: tecnicosRows.map(r => r.v),
      qualityStatuses: KNOWN_REPORT_QUALITY_STATUSES,
      inconsistencyCodes: INCONSISTENCY_TAXONOMY.map(d => d.code),
      severities: SEVERITIES,
      ticketStatuses: TICKET_STATUSES,
      partStatuses: PART_STATUSES
    });
  } catch (error) {
    return handleApiError(error);
  }
}
