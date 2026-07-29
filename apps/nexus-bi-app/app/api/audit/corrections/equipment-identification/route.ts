import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - Familia 5: identificación de equipo (governance.fn_apply_equipment_identification,
// sql/092). Overlay aditivo sobre manual_review.equipment_identification_overrides
// (sql/091) - sin regla de calidad asociada en v1, nunca crea verification_request
// (B8/B81), nunca porta Equipment Lifecycle ni una taxonomía nueva.
interface EquipmentIdentificationRequestBody {
  fieldbeatTaskId?: unknown;
  rawEquipmentReference?: unknown;
  correctedEquipmentInternalId?: unknown;
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
    user = await requireCapability("correction:equipment-identification");
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

  let body: EquipmentIdentificationRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { fieldbeatTaskId, rawEquipmentReference, correctedEquipmentInternalId, reason, expectedVersion } = body;

  if (typeof fieldbeatTaskId !== "number" || !Number.isInteger(fieldbeatTaskId)) {
    return NextResponse.json({ error: "fieldbeatTaskId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (rawEquipmentReference !== undefined && rawEquipmentReference !== null && typeof rawEquipmentReference !== "string") {
    return NextResponse.json({ error: "rawEquipmentReference debe ser texto si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof correctedEquipmentInternalId !== "string" || !correctedEquipmentInternalId.trim()) {
    return NextResponse.json({ error: "correctedEquipmentInternalId es requerido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_apply_equipment_identification: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_apply_equipment_identification($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::integer)",
      [
        user.id,
        user.role,
        fieldbeatTaskId,
        rawEquipmentReference ?? null,
        correctedEquipmentInternalId,
        reason,
        idempotencyKey,
        correlationId,
        expectedVersion ?? null
      ]
    );

    const result = rows[0]?.fn_apply_equipment_identification;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "correction:equipment-identification",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
