import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { fetchIssuesBandeja } from "@/lib/audit-governance-sql";
import { BANDEJA_HAS_CASE_VALUES, BANDEJA_VERIFICATION_VALUES, enumVal } from "@/lib/audit-bandeja-url-state";

export const runtime = "nodejs";

// Gate B - Familia 4/8: pestaña "Bandeja" de /audit/manual-review - backlog
// completo de incidencias (governance.issues), con filtros reales (nunca
// solo la lista sin filtrar). Distinto de /api/audit/summary (KPIs agregados)
// y de /api/explorer/issues (navegación de solo lectura desde Explorador) -
// esta ruta es la superficie operativa de Auditoría.
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 25);

    const { rows, total } = await fetchIssuesBandeja(
      {
        status: searchParams.get("status") ?? undefined,
        severity: searchParams.get("severity") ?? undefined,
        ruleCode: searchParams.get("ruleCode") ?? undefined,
        entityType: searchParams.get("entityType") ?? undefined,
        hasCase: enumVal(searchParams, "hasCase", BANDEJA_HAS_CASE_VALUES),
        verification: enumVal(searchParams, "verification", BANDEJA_VERIFICATION_VALUES),
        q: searchParams.get("q") ?? undefined
      },
      page,
      pageSize
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({ rows, page: Math.min(page, totalPages), pageSize, totalRows: total, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
