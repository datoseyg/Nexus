import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("audit", "pipeline_runs");

// Pensado para que src/db/*.js y src/qa/*.js posteen acá al arrancar/
// terminar una corrida (POST al empezar con status STARTED, PATCH al
// terminar - ver [id]/route.ts). No hay wiring todavía desde el pipeline
// Node existente hacia este endpoint HTTP - eso es trabajo de integración
// aparte, fuera de esta migración (la capa CRUD queda lista para usarse).
export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const stage = searchParams.get("stage");

    const whereClause = stage ? "WHERE stage = $1" : "";
    const whereParams = stage ? [stage] : [];

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE} ${whereClause}`, whereParams);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY started_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
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
    const { stage, metadata } = body ?? {};

    if (!stage) {
      return NextResponse.json({ error: "Falta el campo requerido: stage", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const rows = await runQuery(
      `INSERT INTO ${TABLE} (stage, status, metadata) VALUES ($1, 'STARTED', $2) RETURNING *`,
      [stage, metadata ? JSON.stringify(metadata) : null]
    );

    return NextResponse.json({ row: serializeRows(rows)[0] }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
