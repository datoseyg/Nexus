import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { requireAdminToken } from "@/lib/auth";
import { quoteQualifiedAdminTable } from "@/lib/admin-guardrails";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";

export const runtime = "nodejs";

const TABLE = quoteQualifiedAdminTable("audit", "data_quality_events");
const SEVERITIES = ["INFO", "WARNING", "ERROR"];

export async function GET(request: NextRequest) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const resolved = searchParams.get("resolved");
    const severity = searchParams.get("severity");

    const conditions: string[] = [];
    const whereParams: unknown[] = [];

    if (resolved !== null) {
      whereParams.push(resolved === "true");
      conditions.push(`resolved = $${whereParams.length}`);
    }
    if (severity) {
      whereParams.push(severity);
      conditions.push(`severity = $${whereParams.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRows = await runQuery<{ n: string }>(`SELECT COUNT(*) AS n FROM ${TABLE} ${whereClause}`, whereParams);
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await runQuery(
      `SELECT * FROM ${TABLE} ${whereClause} ORDER BY detected_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
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
    const { run_id, entity_type, entity_id, issue_type, severity, details } = body ?? {};

    if (!entity_type || !entity_id || !issue_type) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: entity_type, entity_id, issue_type", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    if (severity && !SEVERITIES.includes(severity)) {
      return NextResponse.json(
        { error: `severity debe ser uno de: ${SEVERITIES.join(", ")}`, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const rows = await runQuery(
      `INSERT INTO ${TABLE} (run_id, entity_type, entity_id, issue_type, severity, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [run_id ?? null, entity_type, entity_id, issue_type, severity ?? "WARNING", details ? JSON.stringify(details) : null]
    );

    return NextResponse.json({ row: serializeRows(rows)[0] }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
