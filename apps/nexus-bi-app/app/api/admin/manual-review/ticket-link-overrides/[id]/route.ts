import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { logManualReviewAction } from "@/lib/admin-audit-log";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("manual_review", "ticket_link_overrides");
const OVERRIDE_TYPES = ["CONFIRMED_NO_TICKET", "CORRECTED", "DUPLICATE"];
const PATCHABLE_FIELDS = ["raw_linked_zendesk_ticket_id", "corrected_zendesk_ticket_id", "override_type", "reason"] as const;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    if (body?.override_type && !OVERRIDE_TYPES.includes(body.override_type)) {
      return NextResponse.json(
        { error: `override_type debe ser uno de: ${OVERRIDE_TYPES.join(", ")}`, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

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

    values.push(id);

    const rows = await runQuery(
      `UPDATE ${TABLE} SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe manual_review.ticket_link_overrides con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    const updated = serializeRows(rows)[0];
    await logManualReviewAction({ entityId: `ticket_link_overrides:${id}`, issueType: "UPDATED", details: updated });

    return NextResponse.json({ row: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sin columna `active` acá (a diferencia de part_aliases) - DELETE es
// borrado real. Quitar un override revierte esa tarea a "sin corregir",
// que es un estado legítimo (vuelve a aparecer en la cola de revisión).
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    const rows = await runQuery(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING *`, [id]);

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe manual_review.ticket_link_overrides con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    const deleted = serializeRows(rows)[0];
    await logManualReviewAction({ entityId: `ticket_link_overrides:${id}`, issueType: "DEACTIVATED", details: deleted });

    return NextResponse.json({ row: deleted });
  } catch (error) {
    return handleApiError(error);
  }
}
