import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { fetchHistory } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

// Gate B - Familia 4/8: pestaña "Historial" - eventos confirmados
// (governance.command_events_business_safe, B54) - nunca before_state/
// after_state/service_actor_key (esos solo vía fn_read_restricted_event_state,
// Familia 6). Filtrable por caso o por issue para el hilo de un objeto
// concreto; sin filtro, lista el historial completo reciente.
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 25);

    const { rows, total } = await fetchHistory(
      {
        reviewCaseId: searchParams.get("reviewCaseId") ?? undefined,
        issueId: searchParams.get("issueId") ?? undefined
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
