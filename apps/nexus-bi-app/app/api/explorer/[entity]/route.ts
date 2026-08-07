import { NextRequest, NextResponse } from "next/server";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { handleApiError } from "@/lib/api-error";
import { clampExplorerPage, clampExplorerPageSize, resolveExplorerEntityQuery } from "@/lib/explorer-sql";
import type { ExplorerEntity, ExplorerListResponse } from "@/types/explorer";

export const runtime = "nodejs";

// Explorador semántico (Gate B, B20) - un endpoint por entidad de negocio,
// nunca schema.tabla física (eso es exactamente lo que /api/tables hacía y
// que este Explorador reemplaza, B23). Cada rama tiene su propia consulta
// curada (lib/explorer-sql.ts) - nunca SELECT * ni columnas resueltas por
// information_schema. El parseo de filtros y las consultas viven en
// resolveExplorerEntityQuery - la MISMA función que llama
// GET .../export (sección 14: listado/conteo/exportación nunca pueden
// divergir en qué filtran).
const SUPPORTED_ENTITIES: ExplorerEntity[] = [
  "reports",
  "tickets",
  "parts",
  "issues",
  "clients",
  "equipment",
  "technicians",
  "products",
  "contracts"
];

export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const { entity } = await params;
    if (!SUPPORTED_ENTITIES.includes(entity as ExplorerEntity)) {
      return NextResponse.json(
        { error: `Entidad de Explorador no soportada: "${entity}"`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = clampExplorerPage(Number(searchParams.get("page")));
    const pageSize = clampExplorerPageSize(Number(searchParams.get("pageSize")) || 25);
    const offset = (page - 1) * pageSize;

    const { rows, total } = await resolveExplorerEntityQuery(entity as ExplorerEntity, searchParams, pageSize, offset);
    return NextResponse.json(buildResponse(entity as ExplorerEntity, rows, page, pageSize, total));
  } catch (error) {
    return handleApiError(error);
  }
}

function buildResponse(
  entity: ExplorerEntity,
  rows: Record<string, unknown>[],
  page: number,
  pageSize: number,
  totalRows: number
): ExplorerListResponse {
  return {
    entity,
    rows,
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
  };
}
