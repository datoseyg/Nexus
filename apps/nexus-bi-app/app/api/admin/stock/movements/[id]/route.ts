import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("stock", "stock_movements");

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH solo transiciona status: PENDING -> CONFIRMED (descuenta/suma stock
// de verdad, fuera de este endpoint - acá solo se registra la confirmación)
// o PENDING/CONFIRMED -> REVERSED. No se editan dolibarr_product_id/
// quantity/movement_type después de creado (crear uno nuevo en su lugar).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const { status, confirmed_by } = body ?? {};

    if (!status || !["CONFIRMED", "REVERSED"].includes(status)) {
      return NextResponse.json(
        { error: "status debe ser CONFIRMED o REVERSED", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const isConfirm = status === "CONFIRMED";
    const rows = await runQuery(
      isConfirm
        ? `UPDATE ${TABLE} SET status = $1, confirmed_by = $2, confirmed_at = now() WHERE id = $3 RETURNING *`
        : `UPDATE ${TABLE} SET status = $1, reversed_at = now() WHERE id = $3 RETURNING *`,
      isConfirm ? [status, confirmed_by ?? null, id] : [status, null, id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `No existe stock.stock_movements con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ row: serializeRows(rows)[0] });
  } catch (error) {
    return handleApiError(error);
  }
}

// Solo se permite borrar movimientos PENDING - uno CONFIRMED ya pudo haber
// afectado inventario real y borrarlo silenciosamente rompería el rastro;
// la forma correcta de anular uno confirmado es un PATCH a REVERSED.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    const rows = await runQuery(
      `DELETE FROM ${TABLE} WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      const existsRows = await runQuery<{ status: string }>(`SELECT status FROM ${TABLE} WHERE id = $1`, [id]);

      if (existsRows.length === 0) {
        return NextResponse.json({ error: `No existe stock.stock_movements con id ${id}`, code: "NOT_FOUND" }, { status: 404 });
      }

      return NextResponse.json(
        { error: `Solo se pueden borrar movimientos PENDING (este está ${existsRows[0].status}) - usá PATCH a REVERSED en su lugar`, code: "INVALID_STATE" },
        { status: 409 }
      );
    }

    return NextResponse.json({ row: serializeRows(rows)[0] });
  } catch (error) {
    return handleApiError(error);
  }
}
