import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - tercer comando de corrección conectado a HTTP (B8/B14): identidad
// de técnico. Capacidad correction:technician-identity. A diferencia de
// alias/ticket-link, este comando NUNCA crea una verification_request (B81 -
// no hay rule_code de calidad asociado a identidad de técnico en el catálogo
// mínimo) - la respuesta siempre trae verification="NOT_APPLICABLE".
interface TechnicianIdentityRequestBody {
  sourceType?: unknown;
  sourceValueNormalized?: unknown;
  canonicalPersonKey?: unknown;
  canonicalDisplayName?: unknown;
  reason?: unknown;
  expectedVersion?: unknown;
}

const SOURCE_TYPES = ["ASSIGNED_TO_USERNAME", "SIGNATURE_NAME", "ADDITIONAL_FIELD_TOKEN"];

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
    user = await requireCapability("correction:technician-identity");
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

  let body: TechnicianIdentityRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { sourceType, sourceValueNormalized, canonicalPersonKey, canonicalDisplayName, reason, expectedVersion } = body;

  if (typeof sourceType !== "string" || !SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json(
      { error: `sourceType debe ser uno de: ${SOURCE_TYPES.join(", ")}.`, code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  if (typeof sourceValueNormalized !== "string" || !sourceValueNormalized.trim()) {
    return NextResponse.json({ error: "sourceValueNormalized es requerido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof canonicalPersonKey !== "string" || !canonicalPersonKey.trim()) {
    return NextResponse.json({ error: "canonicalPersonKey es requerido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof canonicalDisplayName !== "string" || !canonicalDisplayName.trim()) {
    return NextResponse.json({ error: "canonicalDisplayName es requerido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_apply_technician_identity: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_apply_technician_identity($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10::integer)",
      [
        user.id,
        user.role,
        sourceType,
        sourceValueNormalized,
        canonicalPersonKey,
        canonicalDisplayName,
        reason,
        idempotencyKey,
        correlationId,
        expectedVersion ?? null
      ]
    );

    const result = rows[0]?.fn_apply_technician_identity;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "correction:technician-identity",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
