import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - Familia 6: lectura gobernada del cuerpo ORIGINAL de un comentario
// redactado (governance.fn_read_redacted_comment_original, sql/095) - mismo
// patrón que restricted/evidence (capacidad audit:evidence-restricted, razón
// obligatoria, un comentario por request, rol nexus_audit_restricted_read,
// acceso auditado por la función vía REDACTED_COMMENT_ACCESSED).
interface RestrictedCommentOriginalRequestBody {
  commentId?: unknown;
  reason?: unknown;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginForMutation(request);
  if (originError) return originError;

  let user;
  try {
    user = await requireCapability("audit:evidence-restricted");
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  let body: RestrictedCommentOriginalRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { commentId, reason } = body;

  if (typeof commentId !== "number" || !Number.isInteger(commentId)) {
    return NextResponse.json({ error: "commentId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_read_redacted_comment_original: string }>(
      "audit_restricted_read",
      "SELECT governance.fn_read_redacted_comment_original($1::uuid, $2, $3, $4)",
      [user.id, user.role, commentId, reason]
    );

    return NextResponse.json({ body: rows[0]?.fn_read_redacted_comment_original ?? null }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId: randomUUID(),
        commandType: "audit:evidence-restricted",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }
    return handleApiError(error);
  }
}
