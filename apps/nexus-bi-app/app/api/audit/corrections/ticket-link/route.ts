import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - segundo comando de corrección conectado a HTTP (B8/B14): vínculo
// reporte-ticket. Capacidad correction:ticket-link (hoy solo administracion).
// Mismo patrón que part-alias (B34): el actor se deriva de la sesión, la
// conexión de escritura usa nexus_app_corrections, la autorización real es
// ese rol + su GRANT EXECUTE - requireCapability es solo el primer filtro.
interface TicketLinkRequestBody {
  fieldbeatTaskId?: unknown;
  overrideType?: unknown;
  correctedZendeskTicketId?: unknown;
  reason?: unknown;
  expectedVersion?: unknown;
}

const OVERRIDE_TYPES = ["CONFIRMED_NO_TICKET", "CORRECTED", "DUPLICATE"];

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
    user = await requireCapability("correction:ticket-link");
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

  let body: TicketLinkRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { fieldbeatTaskId, overrideType, correctedZendeskTicketId, reason, expectedVersion } = body;

  if (typeof fieldbeatTaskId !== "number" || !Number.isInteger(fieldbeatTaskId)) {
    return NextResponse.json({ error: "fieldbeatTaskId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof overrideType !== "string" || !OVERRIDE_TYPES.includes(overrideType)) {
    return NextResponse.json(
      { error: `overrideType debe ser uno de: ${OVERRIDE_TYPES.join(", ")}.`, code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  if (overrideType !== "CONFIRMED_NO_TICKET" && (typeof correctedZendeskTicketId !== "number" || !Number.isInteger(correctedZendeskTicketId))) {
    return NextResponse.json(
      { error: "correctedZendeskTicketId es requerido (entero) salvo que overrideType sea CONFIRMED_NO_TICKET.", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion debe ser numérico si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_apply_ticket_link: Record<string, unknown> }>(
      "app_corrections",
      "SELECT governance.fn_apply_ticket_link($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::integer)",
      [
        user.id,
        user.role,
        fieldbeatTaskId,
        overrideType,
        correctedZendeskTicketId ?? null,
        reason,
        idempotencyKey,
        correlationId,
        expectedVersion ?? null
      ]
    );

    const result = rows[0]?.fn_apply_ticket_link;
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "correction:ticket-link",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}
