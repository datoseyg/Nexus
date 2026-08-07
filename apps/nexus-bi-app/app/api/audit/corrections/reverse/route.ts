import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - Familia 5: reversión GENÉRICA de una corrección (governance.fn_reverse_correction,
// sql/092) - alias de repuesto, identidad de técnico, vínculo de ticket e
// identificación de equipo comparten esta misma ruta (la función SQL
// resuelve la escritura efectiva por correction_type internamente, nunca
// SQL dinámico). Solo puede revertir la versión VIGENTE de un target (409
// si ya fue superada); dispara una nueva verification_request SCOPED
// únicamente cuando el tipo de corrección tiene regla asociada (B81:
// part-alias/ticket-link) - identidad de técnico/equipo devuelven
// verification="NOT_APPLICABLE". Nunca borra evidencia histórica.
interface ReverseCorrectionRequestBody {
  correctionVersionId?: unknown;
  reason?: unknown;
  expectedVersion?: unknown;
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
    user = await requireCapability("correction:reverse");
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

  let body: ReverseCorrectionRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { correctionVersionId, reason, expectedVersion } = body;

  if (typeof correctionVersionId !== "number" || !Number.isInteger(correctionVersionId)) {
    return NextResponse.json({ error: "correctionVersionId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_reverse_correction: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_reverse_correction($1::uuid, $2, $3, $4, $5, $6::uuid, $7::integer)",
      [user.id, user.role, correctionVersionId, reason, idempotencyKey, correlationId, expectedVersion ?? null]
    );

    const result = rows[0]?.fn_reverse_correction;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "correction:reverse",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
