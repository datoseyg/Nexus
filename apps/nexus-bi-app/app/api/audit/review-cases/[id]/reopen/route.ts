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

interface ReopenBody {
  reason?: unknown;
  expectedVersion?: unknown;
}

// Gate B - Familia 4: reabre un caso RESOLVED/DISMISSED -> IN_REVIEW
// (governance.fn_reopen_review_case, sql/097). Nunca restaura las membresías
// que el cierre en cascada ya terminó - issues nuevos se agregan vía
// add-issue explícitamente.
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

  const { id } = await params;
  const reviewCaseId = Number(id);
  if (!Number.isInteger(reviewCaseId)) {
    return NextResponse.json({ error: "id de caso inválido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const correlationId = randomUUID();

  let body: ReopenBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { reason, expectedVersion } = body;

  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_reopen_review_case: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_reopen_review_case($1::uuid, $2, $3, $4, $5, $6::uuid, $7::integer)",
      [user.id, user.role, reviewCaseId, reason, idempotencyKey, correlationId, expectedVersion ?? null]
    );

    const result = rows[0]?.fn_reopen_review_case;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "review-case:reopen",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
