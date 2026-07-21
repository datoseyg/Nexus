import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { logManualReviewAction } from "@/lib/admin-audit-log";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("manual_review", "part_aliases");

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PATCHABLE_FIELDS = ["dolibarr_product_id", "dolibarr_ref", "reason", "active"] as const;

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const updates: string[] = [];
    const values: unknown[] = [];

    for (const field of PATCHABLE_FIELDS) {
      if (body && Object.prototype.hasOwnProperty.call(body, field)) {
        values.push(body[field]);
        updates.push(`${field} = $${values.length}`);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    updates.push("updated_at = now()");
    values.push(id);

    const rows = await runQuery(
      `UPDATE ${TABLE} SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe manual_review.part_aliases con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    const updated = serializeRows(rows)[0];
    await logManualReviewAction({ entityId: `part_aliases:${id}`, issueType: "UPDATED", details: updated });

    return NextResponse.json({ row: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

// Soft delete: la tabla tiene `active` justamente para esto - un alias
// desactivado no se borra (queda de referencia histórica), solo deja de
// aplicarse en la cascada de resolución de identidad.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    const rows = await runQuery(
      `UPDATE ${TABLE} SET active = false, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe manual_review.part_aliases con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    const deactivated = serializeRows(rows)[0];
    await logManualReviewAction({ entityId: `part_aliases:${id}`, issueType: "DEACTIVATED", details: deactivated });

    return NextResponse.json({ row: deactivated });
  } catch (error) {
    return handleApiError(error);
  }
}
