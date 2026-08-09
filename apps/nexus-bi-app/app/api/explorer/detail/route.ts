import { NextRequest, NextResponse } from "next/server";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { handleApiError } from "@/lib/api-error";
import {
  fetchClientDetail,
  fetchContractDetail,
  fetchEquipmentDetail,
  fetchIssueDetail,
  fetchPartDetail,
  fetchProductDetail,
  fetchTechnicianDetail,
  fetchTicketDetail
} from "@/lib/explorer-sql";
import { ENTITY_IDENTITY } from "@/types/explorer";
import type { ExplorerDetailResponse, ExplorerEntity } from "@/types/explorer";

export const runtime = "nodejs";

// Detalle del Explorador - mismo patrón de clave-como-query-param que
// /api/search/detail (evita el problema de codificar claves compuestas como
// raw-part:<código> en un segmento de URL, B46). Reportes NO tiene detalle
// propio acá - usa el drawer canónico (FieldbeatReportDetailDrawer), igual
// que Búsqueda (B22: nunca un segundo detalle de reporte).
const DETAIL_ENTITIES: ExplorerEntity[] = ["tickets", "parts", "issues", "clients", "equipment", "technicians", "products", "contracts"];

export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const entity = request.nextUrl.searchParams.get("entity");
    const key = request.nextUrl.searchParams.get("key");

    if (!entity || !key) {
      return NextResponse.json({ error: "Se requieren los parámetros entity y key.", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (entity === "reports") {
      return NextResponse.json(
        { error: "El detalle de reportes no se sirve acá - usa el drawer canónico.", code: "ENTITY_RETIRED" },
        { status: 400 }
      );
    }
    if (!DETAIL_ENTITIES.includes(entity as ExplorerEntity)) {
      return NextResponse.json({ error: `Entidad de Explorador no soportada: "${entity}"`, code: "NOT_FOUND" }, { status: 404 });
    }

    const result = await (async () => {
      switch (entity as ExplorerEntity) {
        case "tickets":
          return fetchTicketDetail(key);
        case "parts":
          return fetchPartDetail(key);
        case "issues":
          return fetchIssueDetail(key);
        case "clients":
          return fetchClientDetail(key);
        case "equipment":
          return fetchEquipmentDetail(key);
        case "technicians":
          return fetchTechnicianDetail(key);
        case "products":
          return fetchProductDetail(key);
        case "contracts":
          return fetchContractDetail(key);
        default:
          return null;
      }
    })();

    if (!result) {
      return NextResponse.json({ error: "No encontrado", code: "NOT_FOUND" }, { status: 404 });
    }

    const response: ExplorerDetailResponse = {
      entity: entity as ExplorerEntity,
      identity: ENTITY_IDENTITY[entity as ExplorerEntity],
      summary: result.summary,
      related: result.related
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
