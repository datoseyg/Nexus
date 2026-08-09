import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { fetchRulesList } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

// Gate B - Familia 8: pestaña "Reglas" - catálogo de reglas (governance.
// rule_definitions/rule_registry), solo lectura. Nunca un editor de reglas
// (Gate A: explícitamente excluido) - el catálogo se define vía migración
// SQL, no desde la UI.
export async function GET() {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const rows = await fetchRulesList();
    return NextResponse.json({ rows });
  } catch (error) {
    return handleApiError(error);
  }
}
