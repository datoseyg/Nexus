import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("audit", "data_quality_events");

export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const resolved = searchParams.get("resolved");
    const severity = searchParams.get("severity");

    const conditions: string[] = [];
    const whereParams: unknown[] = [];

    if (resolved !== null) {
      whereParams.push(resolved === "true");
      conditions.push(`resolved = $${whereParams.length}`);
    }
    if (severity) {
      whereParams.push(severity);
      conditions.push(`severity = $${whereParams.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE} ${whereClause}`, whereParams);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY detected_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      whereParams
    );

    return NextResponse.json({ rows: serializeRows(rows), page: safePage, pageSize, totalRows, totalPages });
  } catch (error) {
    return handleApiError(error);
  }
}

// Gate B (Familia 9/B19) - retirado: audit.data_quality_events no puede
// seguir siendo simultáneamente log de auditoría y tabla CRUD (B21.3 lo
// exigía desde Gate A). governance.command_events (append-only, impuesto
// por grants - B3/B59) ya cumple ese rol para toda escritura nueva, y la
// Auditoría gobernada (Familias 1-8) no depende de esta tabla para nada -
// confirmado sin consumidores reales del POST (ningún componente/ruta la
// invoca). GET se conserva para inspección histórica del legado.
export async function POST() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - el historial de eventos gobernado vive en governance.command_events (append-only, sin escritura CRUD posible desde ninguna ruta).",
      code: "ENDPOINT_RETIRED"
    },
    { status: 410 }
  );
}
