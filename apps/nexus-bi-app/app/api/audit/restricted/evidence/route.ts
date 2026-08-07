import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/capabilities";
import { NexusAuthorizationError } from "@/lib/auth/authorization";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

// Gate B - Familia 6: lectura gobernada de evidencia restringida
// (governance.fn_read_restricted_evidence, sql/095) - capacidad
// audit:evidence-restricted (solo administracion, B11), razón obligatoria,
// UN objeto por request (nunca listar), rol de conexión dedicado
// nexus_audit_restricted_read (nunca nexus_app_read/nexus_app_corrections -
// B13/B72), acceso auditado por la propia función (RESTRICTED_EVIDENCE_ACCESSED).
// Sin Idempotency-Key: cada lectura es un acceso real que debe quedar
// registrado, nunca deduplicado como si fuera un reintento de escritura.
interface RestrictedEvidenceRequestBody {
  evidenceId?: unknown;
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

  let body: RestrictedEvidenceRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { evidenceId, reason } = body;

  if (typeof evidenceId !== "number" || !Number.isInteger(evidenceId)) {
    return NextResponse.json({ error: "evidenceId es requerido (entero).", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" }, { status: 400 });
  }

  try {
    const rows = await runGovernanceQuery<{ fn_read_restricted_evidence: Record<string, unknown> }>(
      "audit_restricted_read",
      "SELECT governance.fn_read_restricted_evidence($1::uuid, $2, $3, $4)",
      [user.id, user.role, evidenceId, reason]
    );

    const result = rows[0]?.fn_read_restricted_evidence;
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
