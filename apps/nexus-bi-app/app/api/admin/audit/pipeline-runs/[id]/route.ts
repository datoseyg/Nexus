import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("audit", "pipeline_runs");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH cierra una corrida STARTED -> SUCCESS/FAILED, con finished_at=now().
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const { status, rows_affected, error_message } = body ?? {};

    if (!status || !["SUCCESS", "FAILED"].includes(status)) {
      return NextResponse.json({ error: "status debe ser SUCCESS o FAILED", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const rows = await runQuery(
      `UPDATE ${TABLE}
       SET status = $1, finished_at = now(), rows_affected = $2, error_message = $3
       WHERE id = $4
       RETURNING *`,
      [status, rows_affected ?? null, error_message ?? null, id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe audit.pipeline_runs con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ row: serializeRows(rows)[0] });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const rows = await runQuery(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING *`, [id]);

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe audit.pipeline_runs con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ row: serializeRows(rows)[0] });
  } catch (error) {
    return handleApiError(error);
  }
}
