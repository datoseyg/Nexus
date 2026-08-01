import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability, NexusAuthorizationError } from "@/lib/auth/capabilities";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";
import type { DataRefreshRunSummary, DataRefreshStartResult } from "@/types/data-refresh";

export const runtime = "nodejs";

// Mecanismo de actualización manual de datos (requisitos 1/2 del encargo
// NEXUS V3) - este endpoint SOLO encola la solicitud (pipeline.fn_start_refresh_run,
// rol nexus_pipeline_requester) y devuelve de inmediato: el trabajo real lo
// procesa scripts/pipeline/local-refresh-worker.mjs (LOCAL) o el job de
// GitHub Actions (STAGING/PRODUCTION, workflow_dispatch manual) - NUNCA
// síncrono dentro de este request HTTP, y NUNCA se dispara desde el login.
const ENVIRONMENTS = ["LOCAL", "STAGING", "PRODUCTION"] as const;
const MODES = ["INCREMENTAL", "FULL"] as const;
const EXECUTOR_TYPES = ["LOCAL", "GITHUB"] as const;

interface StartRequestBody {
  environment?: unknown;
  mode?: unknown;
  executorType?: unknown;
  confirmed?: unknown;
  reason?: unknown;
}

function capabilityForMode(mode: "INCREMENTAL" | "FULL"): string {
  return mode === "FULL" ? "data:refresh:full" : "data:refresh:incremental";
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

  let body: StartRequestBody;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON).", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { environment, mode, confirmed, reason } = body;
  const executorType = body.executorType ?? (environment === "LOCAL" ? "LOCAL" : "GITHUB");

  if (typeof environment !== "string" || !ENVIRONMENTS.includes(environment as (typeof ENVIRONMENTS)[number])) {
    return NextResponse.json({ error: `environment debe ser uno de ${ENVIRONMENTS.join(", ")}.`, code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof mode !== "string" || !MODES.includes(mode as (typeof MODES)[number])) {
    return NextResponse.json({ error: `mode debe ser uno de ${MODES.join(", ")}.`, code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (typeof executorType !== "string" || !EXECUTOR_TYPES.includes(executorType as (typeof EXECUTOR_TYPES)[number])) {
    return NextResponse.json({ error: `executorType debe ser uno de ${EXECUTOR_TYPES.join(", ")}.`, code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return NextResponse.json({ error: "reason debe ser texto si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (confirmed !== undefined && typeof confirmed !== "boolean") {
    return NextResponse.json({ error: "confirmed debe ser booleano si se envía.", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  let user;
  try {
    user = await requireCapability(capabilityForMode(mode as "INCREMENTAL" | "FULL"));
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const responseBody = error.status === 401 ? { error: "Unauthorized", code: "UNAUTHORIZED" } : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(responseBody, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  const correlationId = randomUUID();

  try {
    const rows = await runGovernanceQuery<{ fn_start_refresh_run: DataRefreshStartResult }>(
      "pipeline_requester",
      "SELECT pipeline.fn_start_refresh_run($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9::uuid)",
      [environment, mode, executorType, user.id, user.role, confirmed ?? false, reason ?? null, idempotencyKey, correlationId]
    );

    const result = rows[0]?.fn_start_refresh_run;
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = mapGovernanceFunctionError(error);
    if (mapped) {
      await recordCommandAttempt({
        correlationId,
        commandType: "data-refresh:start",
        actorUserId: user.id,
        errorCode: mapped.body.code
      });
      return governanceErrorResponse(mapped);
    }

    return handleApiError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireCapability("data:refresh:observe");
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const responseBody = error.status === 401 ? { error: "Unauthorized", code: "UNAUTHORIZED" } : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(responseBody, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  try {
    const environment = request.nextUrl.searchParams.get("environment");
    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 10;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (environment) {
      params.push(environment);
      conditions.push(`environment = $${params.length}`);
    }
    params.push(limit);

    const rows = await runGovernanceQuery<Record<string, unknown>>(
      "pipeline_requester",
      `SELECT refresh_run_id, environment, mode, executor_type, status, requested_by_role, requested_at,
              started_at, finished_at, last_heartbeat_at, current_stage, error_code, error_summary, validation_status
       FROM pipeline.refresh_runs
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY requested_at DESC
       LIMIT $${params.length}`,
      params
    );

    const runs: DataRefreshRunSummary[] = rows.map(mapRunSummaryRow);
    return NextResponse.json({ runs }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export function toIso(value: unknown): string | null {
  return value ? new Date(value as string).toISOString() : null;
}

export function mapRunSummaryRow(row: Record<string, unknown>): DataRefreshRunSummary {
  return {
    refreshRunId: String(row.refresh_run_id),
    environment: row.environment as DataRefreshRunSummary["environment"],
    mode: row.mode as DataRefreshRunSummary["mode"],
    executorType: row.executor_type as DataRefreshRunSummary["executorType"],
    status: row.status as DataRefreshRunSummary["status"],
    requestedByRole: (row.requested_by_role as string) ?? null,
    requestedAt: toIso(row.requested_at) as string,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    currentStage: (row.current_stage as string) ?? null,
    errorCode: (row.error_code as string) ?? null,
    errorSummary: (row.error_summary as string) ?? null,
    validationStatus: (row.validation_status as string) ?? null
  };
}
