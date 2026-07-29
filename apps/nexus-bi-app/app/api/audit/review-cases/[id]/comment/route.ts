import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CommentBody {
  body?: unknown;
  supersedesCommentId?: unknown;
}

// Gate B - Familia 4: agrega un comentario inmutable a un caso
// (governance.fn_add_review_case_comment, sql/094). "Editar" un comentario es
// enviar uno nuevo con supersedesCommentId apuntando al anterior - nunca hay
// un PATCH sobre un comentario existente (B33).
export async function POST(request: NextRequest, { params }: RouteParams) {
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
    user = await requireCapability("audit:comment");
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  const { id } = await params;
  const reviewCaseId = Number(id);
  if (!Number.isInteger(reviewCaseId)) {
    return NextResponse.json({ error: "id de caso inválido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const correlationId = randomUUID();

  let requestBody: CommentBody;
  try {
    requestBody = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { body: commentBody, supersedesCommentId } = requestBody;

  if (typeof commentBody !== "string" || !commentBody.trim()) {
    return NextResponse.json({ error: "body es requerido (texto no vacío).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (supersedesCommentId !== undefined && supersedesCommentId !== null && (typeof supersedesCommentId !== "number" || !Number.isInteger(supersedesCommentId))) {
    return NextResponse.json({ error: "supersedesCommentId debe ser un entero si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_add_review_case_comment: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_add_review_case_comment($1::uuid, $2, $3, $4, $5, $6, $7::uuid)",
      [user.id, user.role, reviewCaseId, commentBody, supersedesCommentId ?? null, idempotencyKey, correlationId]
    );

    const result = rows[0]?.fn_add_review_case_comment;
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "review-case:comment",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
