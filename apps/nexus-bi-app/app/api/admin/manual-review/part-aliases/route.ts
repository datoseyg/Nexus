import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { logManualReviewAction } from "@/lib/admin-audit-log";

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

export async function POST(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { alias_value, alias_type, dolibarr_product_id, dolibarr_ref, reason, created_by } = body ?? {};

    if (!alias_value || !alias_type || dolibarr_product_id === undefined) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: alias_value, alias_type, dolibarr_product_id", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    if (!["RAW", "NORMALIZED"].includes(alias_type)) {
      return NextResponse.json(
        { error: "alias_type debe ser RAW o NORMALIZED", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const rows = await runQuery(
      `INSERT INTO ${TABLE} (alias_value, alias_type, dolibarr_product_id, dolibarr_ref, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [alias_value, alias_type, dolibarr_product_id, dolibarr_ref ?? null, reason ?? null, created_by ?? null]
    );

    const created = serializeRows(rows)[0];
    await logManualReviewAction({
      entityId: `part_aliases:${created.id}`,
      issueType: "CREATED",
      details: created
    });

    return NextResponse.json({ row: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
