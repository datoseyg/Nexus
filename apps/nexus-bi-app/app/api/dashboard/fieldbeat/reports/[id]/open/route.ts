import { NextRequest, NextResponse } from "next/server";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { runQuery } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { parseFieldbeatTaskId } from "@/lib/fieldbeat-report-detail-queries";
import { getFieldbeatOpenConfig, buildFieldbeatExternalUrl } from "@/lib/fieldbeat-open-url";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const OPEN_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer"
} as const;

// "Abrir en FieldBeat" (Phase 6, riesgo aceptado 27.B): redirige 302 a la
// app externa de FieldBeat con fleet/token de configuración de servidor
// (nunca NEXT_PUBLIC_, ver lib/fieldbeat-open-url.ts). Existence-check con
// runQuery normal, NO runQueryWithoutJit - medido con EXPLAIN (ANALYZE,
// BUFFERS) contra localhost:55480/nexus_bi_dev_local_test: este SELECT ...
// LIMIT 1 (mismo WHERE de igualdad que buildReportDetailQuery, misma vista
// quality.fieldbeat_report_quality) tiene costo total ~461 y ejecuta en
// ~2-4ms - muy por debajo de jit_above_cost (100000 por defecto). El
// patrón JIT patológico de la Phase 5 (~1.7s) es específico de las
// correlated subqueries de la consulta de detalle completo; no aplica acá.
//
// RISK ACCEPTED — FIELDBEAT ACCESS TOKEN EXPOSED TO AUTHENTICATED USER
// AGENT BY DESIGN: el header Location de la respuesta 302 contiene el
// token en texto plano (decisión del propietario, riesgo 27.B) - queda
// visible en barra de direcciones/historial/DevTools del usuario
// autenticado que sigue el redirect. Nunca se afirma que el token
// permanece secreto después de esta respuesta.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  const { id } = await params;

  try {
    const fieldbeatTaskId = parseFieldbeatTaskId(id);

    const config = getFieldbeatOpenConfig();
    if (!config) {
      logOpenResult(fieldbeatTaskId, "CONFIG_MISSING");
      // Nunca indica CUÁL de los dos valores falta (FIELDBEAT_FLEET vs
      // FIELDBEAT_REPORT_TOKEN) - ni acá ni en handleApiError más abajo.
      return NextResponse.json(
        { error: "La apertura externa en FieldBeat no está configurada en este entorno.", code: "FIELDBEAT_OPEN_NOT_CONFIGURED" },
        { status: 503, headers: OPEN_RESPONSE_HEADERS }
      );
    }

    const rows = await runQuery(
      "SELECT 1 FROM quality.fieldbeat_report_quality WHERE fieldbeat_task_id = $1 LIMIT 1",
      [fieldbeatTaskId]
    );

    if (rows.length === 0) {
      logOpenResult(fieldbeatTaskId, "NOT_FOUND");
      return NextResponse.json(
        { error: `No existe un reporte FieldBeat con ID ${fieldbeatTaskId}`, code: "NOT_FOUND" },
        { status: 404, headers: OPEN_RESPONSE_HEADERS }
      );
    }

    const externalUrl = buildFieldbeatExternalUrl({ fleet: config.fleet, token: config.token, taskId: fieldbeatTaskId });
    logOpenResult(fieldbeatTaskId, "REDIRECT");

    return NextResponse.redirect(externalUrl, { status: 302, headers: OPEN_RESPONSE_HEADERS });
  } catch (error) {
    return handleApiError(error);
  }
}

type OpenResultCode = "REDIRECT" | "NOT_FOUND" | "CONFIG_MISSING";

// Log seguro: SOLO ID de reporte + código de resultado + timestamp. NUNCA
// el token, la URL externa completa, ni el fleet - ni siquiera en caso de
// error (ver arriba: el error de configuración no incluye valores).
function logOpenResult(fieldbeatTaskId: string, result: OpenResultCode): void {
  console.log(`[fieldbeat-open] reportId=${fieldbeatTaskId} result=${result} at=${new Date().toISOString()}`);
}
