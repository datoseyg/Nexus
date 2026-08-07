import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser, NexusAuthorizationError } from "@/lib/auth/authorization";
import { handleApiError } from "@/lib/api-error";
import { escapeCsvCell } from "@/lib/csv-export";
import { MAX_EXPORT_ROWS } from "@/lib/fieldbeat-reports-queries";
import { EXPLORER_ENTITY_CONFIG, formatCell } from "@/lib/explorer-entity-config";
import { runGovernanceQuery } from "@/lib/governance-db";
import { resolveExplorerEntityQuery } from "@/lib/explorer-sql";
import type { ExplorerEntity } from "@/types/explorer";

export const runtime = "nodejs";

// Gate B - Familia 7: exportación CSV de cualquier entidad del Explorador
// semántico - MISMA función de resolución que GET /api/explorer/[entity]
// (resolveExplorerEntityQuery, sección 14 - nunca un segundo parseo de
// filtros paralelo). Sin paginar: universo completo hasta MAX_EXPORT_ROWS.
// Columnas = EXPLORER_ENTITY_CONFIG[entity].listColumns (el mismo allowlist
// ya usado en pantalla, B21 - nunca expone un campo "excluido siempre"
// porque esos nunca están en listColumns). Gerencia puede exportar sin
// permisos de escritura general (B76).
const SUPPORTED_ENTITIES: ExplorerEntity[] = ["reports", "tickets", "parts", "issues", "clients", "equipment", "technicians", "products", "contracts"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  try {
    const { entity: rawEntity } = await params;
    if (!SUPPORTED_ENTITIES.includes(rawEntity as ExplorerEntity)) {
      return NextResponse.json({ error: `Entidad de Explorador no soportada: "${rawEntity}"`, code: "NOT_FOUND" }, { status: 404 });
    }
    const entity = rawEntity as ExplorerEntity;
    const config = EXPLORER_ENTITY_CONFIG[entity];
    const searchParams = request.nextUrl.searchParams;

    const { rows, total } = await resolveExplorerEntityQuery(entity, searchParams, MAX_EXPORT_ROWS, 0);

    if (total > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        {
          error: `La exportación supera el límite de ${MAX_EXPORT_ROWS.toLocaleString("es-CL")} filas (universo: ${total.toLocaleString("es-CL")}). Acota antes de exportar.`,
          code: "EXPORT_LIMIT_EXCEEDED",
          totalRows: total,
          maxExportRows: MAX_EXPORT_ROWS
        },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const lines = [
      config.listColumns.map(c => escapeCsvCell(c.header)).join(","),
      ...rows.map(row => config.listColumns.map(c => escapeCsvCell(formatCell(c, row))).join(","))
    ];

    await runGovernanceQuery(
      "app_read",
      "SELECT governance.fn_record_export_completed($1::uuid, $2, $3, $4::jsonb, $5::integer, $6)",
      [user.id, user.role, `explorer-${entity}`, JSON.stringify({}), rows.length, "csv"]
    );

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nexus-explorador-${entity}-${today}.csv"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
