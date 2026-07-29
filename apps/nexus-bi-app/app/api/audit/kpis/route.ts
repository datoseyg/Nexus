import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { fetchGovernanceKpis } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

// Gate B - Familia 8: pestaña "Resumen" - KPIs de gobierno (governance.issues/
// verification_requests/correction_versions). Complementa, nunca reemplaza,
// GET /api/audit/summary (marts, alimenta también el badge del NavBar).
export async function GET() {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const kpis = await fetchGovernanceKpis();
    return NextResponse.json(kpis);
  } catch (error) {
    return handleApiError(error);
  }
}
