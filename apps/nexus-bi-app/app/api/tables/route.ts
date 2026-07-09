import { NextResponse } from "next/server";
import { listTables } from "@/lib/sql-guardrails";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Lista los schema.table disponibles para el Explorador de Tablas.
// El schema "reports" queda excluido a propósito (está vacío en v1.3,
// ver docs/SQL_WAREHOUSE.md).
export async function GET() {
  try {
    const tables = await listTables();
    return NextResponse.json({ tables });
  } catch (error) {
    return handleApiError(error);
  }
}
