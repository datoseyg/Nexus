import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser, NexusAuthorizationError } from "@/lib/auth/authorization";
import { handleApiError } from "@/lib/api-error";
import { escapeCsvCell } from "@/lib/csv-export";
import { MAX_EXPORT_ROWS } from "@/lib/fieldbeat-reports-queries";
import { fetchIssuesBandeja } from "@/lib/audit-governance-sql";
import { runGovernanceQuery } from "@/lib/governance-db";
import { BANDEJA_HAS_CASE_VALUES, BANDEJA_VERIFICATION_VALUES, enumVal } from "@/lib/audit-bandeja-url-state";

export const runtime = "nodejs";

// Gate B - Familia 7: exportación CSV de la Bandeja de incidencias. Mismos
// filtros server-side que el listado (GET /api/audit/issues), tope
// defensivo MAX_EXPORT_ROWS (413 si el universo filtrado lo supera, nunca
// un CSV truncado presentado como completo), escape de fórmulas
// (lib/csv-export.ts), sin payloads crudos ni columnas fuera del allowlist
// de la Bandeja. Gerencia puede exportar sin permisos de escritura general
// (B76: fn_record_export_completed está otorgada también a nexus_app_read).
const CSV_COLUMNS: Array<{ header: string; key: string }> = [
  { header: "id", key: "id" },
  { header: "regla", key: "rule_title" },
  { header: "severidad", key: "severity" },
  { header: "estado", key: "status" },
  { header: "tipo_entidad", key: "entity_type" },
  { header: "clave_entidad", key: "entity_key" },
  { header: "primera_deteccion", key: "first_seen_at" },
  { header: "ultima_deteccion", key: "last_seen_at" },
  { header: "detectada_actualmente", key: "is_currently_detected" },
  { header: "caso_activo", key: "active_review_case_id" }
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
    const filters = {
      status: searchParams.get("status") ?? undefined,
      severity: searchParams.get("severity") ?? undefined,
      ruleCode: searchParams.get("ruleCode") ?? undefined,
      entityType: searchParams.get("entityType") ?? undefined,
      hasCase: enumVal(searchParams, "hasCase", BANDEJA_HAS_CASE_VALUES),
      verification: enumVal(searchParams, "verification", BANDEJA_VERIFICATION_VALUES),
      q: searchParams.get("q") ?? undefined
    };

    const { rows, total } = await fetchIssuesBandeja(filters, 1, MAX_EXPORT_ROWS);

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
      [user.id, user.role, "audit-issues", JSON.stringify(filters), rows.length, "csv"]
    );

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nexus-auditoria-bandeja-${today}.csv"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
