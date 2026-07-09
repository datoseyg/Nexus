import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("stock", "stock_movements");
const MOVEMENT_TYPES = ["OUT", "IN", "ADJUSTMENT"];

// stock.stock_movements es forward-looking (ver PHASE_2_BACKLOG.md ítem 4
// y docs/ARCHITECTURE.md) - el pipeline actual NO descuenta inventario en
// Dolibarr todavía, esta tabla es el punto de partida transaccional para
// cuando esa automatización se decida construir.
export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const status = searchParams.get("status");

    const whereClause = status ? "WHERE status = $1" : "";
    const whereParams = status ? [status] : [];

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE} ${whereClause}`, whereParams);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      whereParams
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
    const {
      dolibarr_product_id,
      dolibarr_ref,
      movement_type,
      quantity,
      source_used_part_id,
      source_fieldbeat_task_id,
      warehouse_location,
      notes
    } = body ?? {};

    if (dolibarr_product_id === undefined || !movement_type || quantity === undefined) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: dolibarr_product_id, movement_type, quantity", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    if (!MOVEMENT_TYPES.includes(movement_type)) {
      return NextResponse.json(
        { error: `movement_type debe ser uno de: ${MOVEMENT_TYPES.join(", ")}`, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    // status siempre nace PENDING - confirmar/revertir es un PATCH aparte
    // (ver [id]/route.ts), nunca se crea ya confirmado.
    const rows = await runQuery(
      `INSERT INTO ${TABLE}
         (dolibarr_product_id, dolibarr_ref, movement_type, quantity, source_used_part_id, source_fieldbeat_task_id, warehouse_location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        dolibarr_product_id,
        dolibarr_ref ?? null,
        movement_type,
        quantity,
        source_used_part_id ?? null,
        source_fieldbeat_task_id ?? null,
        warehouse_location ?? null,
        notes ?? null
      ]
    );

    return NextResponse.json({ row: serializeRows(rows)[0] }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
