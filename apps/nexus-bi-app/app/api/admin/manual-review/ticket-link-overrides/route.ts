import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("manual_review", "ticket_link_overrides");

export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE}`);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`
    );

    return NextResponse.json({ rows: serializeRows(rows), page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}

// Gate B (B19) - retirado: fn_apply_ticket_link (sql/092) + POST
// /api/audit/corrections/ticket-link ya cubren este comando de forma
// gobernada (actor derivado de sesión, versión/idempotencia, event log,
// verificación posterior contra quality.fieldbeat_ticket_linkage) -
// confirmado probado de punta a punta (HTTP + outbox + PASSED/STILL_DETECTED)
// antes de retirar este endpoint. Sin consumidores reales (Gate A). GET se
// conserva para inspección histórica.
export async function POST() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - usa POST /api/audit/corrections/ticket-link (sesión + capacidad correction:ticket-link).",
      code: "ENDPOINT_RETIRED"
    },
    { status: 410 }
  );
}
