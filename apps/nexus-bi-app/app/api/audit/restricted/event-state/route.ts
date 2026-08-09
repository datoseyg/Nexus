import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - Familia 6: lectura gobernada del estado restringido de un evento
// (before_state/after_state/service_actor_key, governance.fn_read_restricted_event_state,
// sql/095) - mismo patrón que restricted/evidence y restricted/comment-original.
interface RestrictedEventStateRequestBody {
  commandEventId?: unknown;
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

  let body: RestrictedEventStateRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { commandEventId, reason } = body;

  if (typeof commandEventId !== "number" || !Number.isInteger(commandEventId)) {
    return NextResponse.json({ error: "commandEventId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_read_restricted_event_state: Record<string, unknown> }>(
      "audit_restricted_read",
      "SELECT governance.fn_read_restricted_event_state($1::uuid, $2, $3, $4)",
      [user.id, user.role, commandEventId, reason]
    );

    const result = rows[0]?.fn_read_restricted_event_state;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
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
