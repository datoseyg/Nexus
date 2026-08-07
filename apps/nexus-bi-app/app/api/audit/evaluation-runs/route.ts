import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { fetchPipelineRuns } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

// Gate B - Familia 8: pestaña "Fuentes y pipeline" - corridas del evaluador
// de reglas (governance.rule_evaluation_runs), solo lectura. Nombre
// deliberadamente distinto de /api/admin/audit/pipeline-runs (tabla legacy
// audit.pipeline_runs, sin relación - ver Familia 9) para no confundir dos
// conceptos distintos bajo el mismo nombre.
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 20);

    const { rows, total } = await fetchPipelineRuns(page, pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({ rows, page: Math.min(page, totalPages), pageSize, totalRows: total, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}
