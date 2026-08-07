import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { fetchCorrectionVersionsList } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

// Gate B - Familia 8: pestaña "Correcciones" - historial de versiones de
// governance.correction_versions (alias/identidad técnico/vínculo ticket/
// identificación de equipo/reversión), con estado efectivo, versión, actor,
// fecha, razón. Solo lectura - aplicar/revertir correcciones sigue viviendo
// en sus propias rutas de comando (Familias 1/2/5).
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 25);

    const { rows, total } = await fetchCorrectionVersionsList({ correctionType: searchParams.get("correctionType") ?? undefined }, page, pageSize);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({ rows, page: Math.min(page, totalPages), pageSize, totalRows: total, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
