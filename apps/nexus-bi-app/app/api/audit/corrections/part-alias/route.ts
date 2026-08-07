import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - primer comando de corrección real conectado a HTTP (B8/B14):
// alias histórico de repuesto. Capacidad correction:part-alias
// (governance.role_capabilities, hoy solo administracion). El actor SIEMPRE
// se deriva de la sesión (B12/21.13) - el body NUNCA acepta un campo de
// actor. La conexión de escritura usa el rol PostgreSQL nexus_app_corrections
// (governance-db.ts), nunca el pool genérico de lectura - la autorización
// real es ese rol + su GRANT EXECUTE (B34), requireCapability es solo el
// primer filtro de aplicación.
interface PartAliasRequestBody {
  aliasValue?: unknown;
  aliasType?: unknown;
  dolibarrProductId?: unknown;
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
    user = await requireCapability("correction:part-alias");
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

  let body: PartAliasRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { aliasValue, aliasType, dolibarrProductId, reason, expectedVersion } = body;

  if (typeof aliasValue !== "string" || !aliasValue.trim()) {
    return NextResponse.json({ error: "aliasValue es requerido.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (aliasType !== "RAW" && aliasType !== "NORMALIZED") {
    return NextResponse.json({ error: "aliasType debe ser RAW o NORMALIZED.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof dolibarrProductId !== "number" || !Number.isInteger(dolibarrProductId)) {
    return NextResponse.json({ error: "dolibarrProductId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_apply_part_alias: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_apply_part_alias($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::integer)",
      [
        user.id,
        user.role,
        aliasValue,
        aliasType,
        dolibarrProductId,
        reason,
        idempotencyKey,
        correlationId,
        expectedVersion ?? null
      ]
    );

    const result = rows[0]?.fn_apply_part_alias;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "correction:part-alias",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
