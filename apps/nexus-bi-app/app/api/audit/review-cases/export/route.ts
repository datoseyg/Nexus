import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser, NexusAuthorizationError } from "@/lib/auth/authorization";
import { handleApiError } from "@/lib/api-error";
import { escapeCsvCell } from "@/lib/csv-export";
import { MAX_EXPORT_ROWS } from "@/lib/fieldbeat-reports-queries";
import { fetchReviewCasesList } from "@/lib/audit-governance-sql";
import { runGovernanceQuery } from "@/lib/governance-db";

export const runtime = "nodejs";

// Gate B - Familia 7: exportación CSV de la pestaña Casos. Mismo patrón que
// /api/audit/issues/export - filtros server-side, tope MAX_EXPORT_ROWS,
// escape de fórmulas, EXPORT_COMPLETED registrado.
const CSV_COLUMNS: Array<{ header: string; key: string }> = [
  { header: "id", key: "id" },
  { header: "estado", key: "status" },
  { header: "asignado_a", key: "assigned_to" },
  { header: "abierto", key: "opened_at" },
  { header: "cerrado", key: "closed_at" },
  { header: "incidencias_activas", key: "active_issue_count" },
  { header: "comentarios", key: "comment_count" }
];

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const filters = { status: searchParams.get("status") ?? undefined };

    const { rows, total } = await fetchReviewCasesList(filters, 1, MAX_EXPORT_ROWS);

    if (total > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        {
          error: `La exportación supera el límite de ${MAX_EXPORT_ROWS.toLocaleString("es-CL")} filas (universo filtrado: ${total.toLocaleString("es-CL")}). Acota los filtros antes de exportar.`,
          code: "EXPORT_LIMIT_EXCEEDED",
          totalRows: total,
          maxExportRows: MAX_EXPORT_ROWS
        },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const lines = [
      CSV_COLUMNS.map(c => escapeCsvCell(c.header)).join(","),
      ...rows.map(row => CSV_COLUMNS.map(c => escapeCsvCell(row[c.key])).join(","))
    ];

    await runGovernanceQuery(
      "app_read",
      "SELECT governance.fn_record_export_completed($1::uuid, $2, $3, $4::jsonb, $5::integer, $6)",
      [user.id, user.role, "audit-review-cases", JSON.stringify(filters), rows.length, "csv"]
    );

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nexus-auditoria-casos-${today}.csv"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
