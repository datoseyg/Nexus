import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("audit", "pipeline_runs");

// GET se conserva para inspección histórica (Gate B, Familia 9/B19) - el
// POST/PATCH/DELETE de escritura quedan retirados más abajo/en [id]/route.ts.
export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const stage = searchParams.get("stage");

    const whereClause = stage ? "WHERE stage = $1" : "";
    const whereParams = stage ? [stage] : [];

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE} ${whereClause}`, whereParams);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY started_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      whereParams
    );

    return NextResponse.json({ rows: serializeRows(rows), page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}

// Gate B (Familia 9/B19) - retirado: sin consumidor real confirmado
// (comentario original de este archivo ya documentaba "no hay wiring todavía
// desde el pipeline Node existente hacia este endpoint HTTP"). El único
// escritor real de audit.pipeline_runs es src/working-hours/build-working-hours.js,
// que escribe DIRECTO vía SQL (bypass de esta capa HTTP por completo) - la
// TABLA sigue viva y en uso, solo esta ruta HTTP queda retirada. Si en el
// futuro se necesita instrumentar pipelines vía HTTP, usa una identidad de
// servicio dedicada (B11/B12), nunca x-nexus-admin-token como credencial
// universal.
export async function POST() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - sin consumidor real; audit.pipeline_runs sigue escrita directamente por el pipeline de horas trabajadas vía SQL, no por esta ruta.",
      code: "ENDPOINT_RETIRED"
    },
    { status: 410 }
  );
}
