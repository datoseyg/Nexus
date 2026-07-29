import { randomUUID } from "node:crypto";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";
import { clampPage, clampPageSize } from "@/lib/sql-guardrails";
import { fetchReviewCasesList, fetchReviewCasesStatusCounts } from "@/lib/audit-governance-sql";

export const runtime = "nodejs";

// Gate B - Familia 4: pestaña "Casos" - listar (GET, cualquier rol con
// lectura) y crear (POST, capacidad audit:review) casos de revisión
// (governance.fn_create_review_case, sql/094).
export async function GET(request: NextRequest) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")) || 25);

    const [{ rows, total }, statusCounts] = await Promise.all([
      fetchReviewCasesList({ status: searchParams.get("status") ?? undefined }, page, pageSize),
      fetchReviewCasesStatusCounts()
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({ rows, page: Math.min(page, totalPages), pageSize, totalRows: total, totalPages, statusCounts });
  } catch (error) {
    return handleApiError(error);
  }
}

interface CreateReviewCaseBody {
  issueIds?: unknown;
  reason?: unknown;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginForMutation(request);
  if (originError) return originError;

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "Falta el header Idempotency-Key.", code: "VALIDATION_ERROR" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  let user;
  try {
    user = await requireCapability("audit:review");
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  const correlationId = randomUUID();

  let body: CreateReviewCaseBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { issueIds, reason } = body;

  if (!Array.isArray(issueIds) || issueIds.length === 0 || !issueIds.every(id => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "issueIds es requerido (arreglo de enteros, al menos uno).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_create_review_case: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_create_review_case($1::uuid, $2, $3::bigint[], $4, $5, $6::uuid)",
      [user.id, user.role, issueIds, reason, idempotencyKey, correlationId]
    );

    const result = rows[0]?.fn_create_review_case;
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "review-case:create",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
