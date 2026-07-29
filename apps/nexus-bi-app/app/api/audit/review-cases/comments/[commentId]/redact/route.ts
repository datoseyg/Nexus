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
  params: Promise<{ commentId: string }>;
}

interface RedactBody {
  redactionReason?: unknown;
}

// Gate B - Familia 4: redacta un comentario (governance.fn_redact_review_case_comment,
// sql/094) - capacidad SEPARADA correction:redact-comment (nunca audit:comment
// solo), nunca toca `body` (solo is_redacted/redaction_reason/*), el texto
// original queda restringido a fn_read_redacted_comment_original (Familia 6).
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
    user = await requireCapability("correction:redact-comment");
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  const { commentId } = await params;
  const parsedCommentId = Number(commentId);
  if (!Number.isInteger(parsedCommentId)) {
    return NextResponse.json({ error: "id de comentario inválido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const correlationId = randomUUID();

  let body: RedactBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { redactionReason } = body;
  if (typeof redactionReason !== "string" || !redactionReason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_redact_review_case_comment: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_redact_review_case_comment($1::uuid, $2, $3, $4, $5, $6::uuid)",
      [user.id, user.role, parsedCommentId, redactionReason, idempotencyKey, correlationId]
    );

    const result = rows[0]?.fn_redact_review_case_comment;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "review-case:redact-comment",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
