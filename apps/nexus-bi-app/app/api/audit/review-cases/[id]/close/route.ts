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

interface CloseBody {
  finalStatus?: unknown;
  reason?: unknown;
  expectedVersion?: unknown;
}

const FINAL_STATUSES = ["RESOLVED", "DISMISSED"];

// Gate B - Familia 4: cierra un caso RESOLVED o DISMISSED
// (governance.fn_close_review_case, sql/094) - cierra en cascada TODAS sus
// membresías activas en la misma transacción (B53), nunca deja una
// membresía activa asociada a un caso ya cerrado.
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

  let body: CloseBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { finalStatus, reason, expectedVersion } = body;

  if (typeof finalStatus !== "string" || !FINAL_STATUSES.includes(finalStatus)) {
    return NextResponse.json({ error: `finalStatus debe ser uno de: ${FINAL_STATUSES.join(", ")}.`, code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_close_review_case: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_close_review_case($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::integer)",
      [user.id, user.role, reviewCaseId, finalStatus, reason, idempotencyKey, correlationId, expectedVersion ?? null]
    );

    const result = rows[0]?.fn_close_review_case;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "review-case:close",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
