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

interface AssignBody {
  assigneeUserId?: unknown;
  reason?: unknown;
  expectedVersion?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gate B - Familia 4: asigna/reasigna un caso (governance.fn_assign_review_case,
// sql/094). El producto no tiene todavía un directorio de usuarios (ningún
// otro punto de NEXUS lo tiene) - se ofrece "asignarme a mí" (assigneeUserId
// se omite -> se usa la sesión actual) en vez de inventar un selector de
// usuarios sin datos reales que lo respalden.
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
    user = await requireCapability("audit:assign");
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

  let body: AssignBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { assigneeUserId, reason, expectedVersion } = body;
  const resolvedAssigneeId = assigneeUserId === undefined || assigneeUserId === null ? user.id : assigneeUserId;

  if (typeof resolvedAssigneeId !== "string" || !UUID_PATTERN.test(resolvedAssigneeId)) {
    return NextResponse.json({ error: "assigneeUserId debe ser un UUID válido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return NextResponse.json({ error: "reason debe ser texto si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_assign_review_case: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_assign_review_case($1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8::integer)",
      [user.id, user.role, reviewCaseId, resolvedAssigneeId, reason ?? null, idempotencyKey, correlationId, expectedVersion ?? null]
    );

    const result = rows[0]?.fn_assign_review_case;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "review-case:assign",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
