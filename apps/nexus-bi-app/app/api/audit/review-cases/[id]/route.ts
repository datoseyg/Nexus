import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { fetchReviewCaseDetail } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const detail = await fetchReviewCaseDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Caso de revisión no encontrado.", code: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return handleApiError(error);
  }
}
