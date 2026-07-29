import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("manual_review", "part_aliases");

// CRUD server-to-server para manual_review.part_aliases (protegido por
// x-nexus-admin-token) - NO conectado a ninguna UI pública todavía, ver
// docs/RUNBOOK_SUPABASE_NETLIFY.md § autenticación sobre por qué.
export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const activeOnly = searchParams.get("activeOnly") !== "false";

    const whereClause = activeOnly ? "WHERE active = true" : "";

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE} ${whereClause}`);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`
    );

    return NextResponse.json({ rows: serializeRows(rows), page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}

// Gate B (B19) - retirado: fn_apply_part_alias (sql/090) + POST
// /api/audit/corrections/part-alias ya cubren este comando de forma
// gobernada (actor derivado de sesión, versión/idempotencia, event log,
// verificación posterior) - confirmado sin consumidores reales de este
// endpoint legacy (Gate A). Escritura vía token compartido deshabilitada en
// el mismo cambio que activó la función nueva (nunca ambos caminos de
// escritura activos a la vez) - GET se conserva para inspección histórica.
export async function POST() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - usa POST /api/audit/corrections/part-alias (sesión + capacidad correction:part-alias).",
      code: "ENDPOINT_RETIRED"
    },
    { status: 410 }
  );
}
