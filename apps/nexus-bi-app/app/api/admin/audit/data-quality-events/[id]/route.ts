import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("audit", "data_quality_events");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH está pensado principalmente para marcar resolved=true (con
// resolved_at=now()) - se acepta cualquier subset de {resolved, details}
// por si hace falta anotar cómo se resolvió sin reabrir el evento.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    if (body?.resolved === undefined) {
      return NextResponse.json({ error: "Falta el campo requerido: resolved", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const updates = ["resolved = $1"];
    const values: unknown[] = [Boolean(body.resolved)];

    updates.push(body.resolved ? "resolved_at = now()" : "resolved_at = NULL");

    if (Object.prototype.hasOwnProperty.call(body, "details")) {
      values.push(JSON.stringify(body.details));
      updates.push(`details = $${values.length}`);
    }

    values.push(id);

    const rows = await runQuery(
      `UPDATE ${TABLE} SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe audit.data_quality_events con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
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
      return NextResponse.json({ error: `No existe audit.data_quality_events con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ row: serializeRows(rows)[0] });
  } catch (error) {
    return handleApiError(error);
  }
}
