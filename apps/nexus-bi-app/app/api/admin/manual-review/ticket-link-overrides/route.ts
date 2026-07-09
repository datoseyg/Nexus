import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { logManualReviewAction } from "@/lib/admin-audit-log";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("manual_review", "ticket_link_overrides");
const OVERRIDE_TYPES = ["CONFIRMED_NO_TICKET", "CORRECTED", "DUPLICATE"];

export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE}`);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`
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
    const { fieldbeat_task_id, raw_linked_zendesk_ticket_id, corrected_zendesk_ticket_id, override_type, reason, created_by } = body ?? {};

    if (fieldbeat_task_id === undefined || !override_type) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: fieldbeat_task_id, override_type", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    if (!OVERRIDE_TYPES.includes(override_type)) {
      return NextResponse.json(
        { error: `override_type debe ser uno de: ${OVERRIDE_TYPES.join(", ")}`, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    // Mismo chequeo que el CHECK constraint de la tabla, para devolver un
    // 400 legible en vez de que la primera señal sea un error crudo de Postgres.
    if (override_type !== "CONFIRMED_NO_TICKET" && corrected_zendesk_ticket_id === undefined) {
      return NextResponse.json(
        { error: "corrected_zendesk_ticket_id es requerido salvo que override_type sea CONFIRMED_NO_TICKET", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const rows = await runQuery(
      `INSERT INTO ${TABLE} (fieldbeat_task_id, raw_linked_zendesk_ticket_id, corrected_zendesk_ticket_id, override_type, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        fieldbeat_task_id,
        raw_linked_zendesk_ticket_id ?? null,
        corrected_zendesk_ticket_id ?? null,
        override_type,
        reason ?? null,
        created_by ?? null
      ]
    );

    const created = serializeRows(rows)[0];
    await logManualReviewAction({
      entityId: `ticket_link_overrides:${created.id}`,
      issueType: "CREATED",
      details: created
    });

    return NextResponse.json({ row: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
