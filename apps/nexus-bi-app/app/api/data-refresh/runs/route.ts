import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability, NexusAuthorizationError } from "@/lib/auth/capabilities";
import { requireSameOriginForMutation } from "@/lib/auth/origin-guard";
import { runGovernanceQuery } from "@/lib/governance-db";
import { mapGovernanceFunctionError, governanceErrorResponse, recordCommandAttempt } from "@/lib/governance-errors";
import { handleApiError } from "@/lib/api-error";
import { dispatchDataRefreshWorkflow } from "@/lib/github-actions-dispatch";
import type { DataRefreshEnvironment, DataRefreshExecutorType, DataRefreshRunSummary, DataRefreshStartResult } from "@/types/data-refresh";

export const runtime = "nodejs";

// Mecanismo de actualización manual de datos (requisitos 1/2 del encargo
// NEXUS V3) - este endpoint SOLO encola la solicitud (pipeline.fn_start_refresh_run,
// rol nexus_pipeline_requester) y devuelve de inmediato: el trabajo real lo
// procesa scripts/pipeline/local-refresh-worker.mjs (LOCAL) o el job de
// GitHub Actions (STAGING/PRODUCTION, workflow_dispatch, ahora disparado
// automáticamente por este mismo POST - ver liveRefreshRunStatus más abajo)
// - NUNCA síncrono dentro de este request HTTP, y NUNCA se dispara desde el
// login.
const ENVIRONMENTS = ["LOCAL", "STAGING", "PRODUCTION"] as const;
const MODES = ["INCREMENTAL", "FULL"] as const;

interface StartRequestBody {
  mode?: unknown;
  confirmed?: unknown;
  reason?: unknown;
}

function capabilityForMode(mode: "INCREMENTAL" | "FULL"): string {
  return mode === "FULL" ? "data:refresh:full" : "data:refresh:incremental";
}

// Blocker de revisión de producto - "el botón real sigue siendo LOCAL": el
// body HTTP ya NO transporta environment/executorType (StartRequestBody de
// arriba ni siquiera los declara) - el navegador NUNCA decide contra qué
// entorno se dispara un refresh, sin importar qué envíe. El backend resuelve
// el destino real una sola vez por deployment, vía una variable de entorno
// SERVER-ONLY (jamás NEXT_PUBLIC_* - esto es una decisión de autorización,
// no un valor de UI) que cada deployment de Netlify configura por su cuenta:
//   NEXUS_REFRESH_ENVIRONMENT=LOCAL|STAGING|PRODUCTION
//
// Corrección focal post-revisión - "LOCAL por defecto es conveniente para
// desarrollo local, pero inaceptable en un deployment productivo": una
// omisión de configuración en Netlify (variable no seteada) NUNCA debe caer
// a LOCAL en ese contexto - eso crearía corridas executor_type=LOCAL contra
// la base remota, que ningún worker local puede llegar a reclamar (el
// propio local-refresh-worker.mjs se niega a correr contra un host Supabase
// cloud, ver ADR 0001) - la corrida quedaría QUEUED para siempre, invisible.
// El default LOCAL sigue existiendo, pero SOLO fuera de un runtime
// productivo real (NODE_ENV=production) - la MISMA señal que ya usa este
// código base para distinguir ese caso (ver lib/auth/authorization.ts:19,
// lib/db.ts:149/163): Next.js fija NODE_ENV=production dentro de `next
// build`/`next start` de forma incondicional (nunca heredado ni opcional),
// y netlify.toml despliega exactamente eso (`command = "npm run build"`,
// ver apps/nexus-bi-app/package.json::build) - `next dev` (desarrollo
// local) siempre queda en "development". Ninguna variable NETLIFY_*/CONTEXT
// se usa en ningún otro punto de este repo; NODE_ENV es la única señal ya
// establecida, sin inventar una nueva.
//
// LOCAL explícito bajo NODE_ENV=production TAMBIÉN falla cerrado (no solo
// la omisión): no existe en este repo ningún flujo documentado (ADR 0001,
// docs/data-refresh-runbook.md, scripts/smoke.mjs) que dependa de correr
// una build de producción localmente con executor LOCAL - LOCAL es, por
// diseño de ADR 0001, exclusivo de una máquina de desarrollo con
// local-refresh-worker.mjs corriendo; un deployment productivo (Netlify)
// nunca tiene ese worker disponible, sin importar si el valor llegó vacío
// o fue tipeado a mano. Sin una razón operacional real para la excepción,
// se prefiere la regla uniforme (nunca LOCAL bajo NODE_ENV=production) en
// vez de abrir un caso especial. Un valor inválido (typo) sigue fallando
// fuerte siempre, sin importar NODE_ENV.
export function resolveRefreshEnvironment(): DataRefreshEnvironment {
  const raw = process.env.NEXUS_REFRESH_ENVIRONMENT;
  const isProductionRuntime = process.env.NODE_ENV === "production";

  if (!raw) {
    if (isProductionRuntime) {
      throw new Error(
        "Falta NEXUS_REFRESH_ENVIRONMENT en un deployment productivo (NODE_ENV=production) - nunca se asume LOCAL " +
        "por defecto acá (crearía corridas LOCAL en una base remota que ningún worker local puede procesar). " +
        "Configurar NEXUS_REFRESH_ENVIRONMENT=STAGING|PRODUCTION en las variables de entorno de este deployment."
      );
    }
    return "LOCAL";
  }

  if (!ENVIRONMENTS.includes(raw as DataRefreshEnvironment)) {
    throw new Error(`NEXUS_REFRESH_ENVIRONMENT inválido: "${raw}". Debe ser uno de ${ENVIRONMENTS.join(", ")}.`);
  }

  if (raw === "LOCAL" && isProductionRuntime) {
    throw new Error(
      "NEXUS_REFRESH_ENVIRONMENT=LOCAL no es válido bajo NODE_ENV=production - el ejecutor LOCAL solo puede " +
      "procesarlo scripts/pipeline/local-refresh-worker.mjs corriendo en una máquina de desarrollo (ver ADR 0001), " +
      "nunca disponible en un deployment. Si este deployment es realmente STAGING o PRODUCTION, configurar " +
      "NEXUS_REFRESH_ENVIRONMENT en consecuencia."
    );
  }

  return raw as DataRefreshEnvironment;
}

// LOCAL -> worker local (scripts/pipeline/local-refresh-worker.mjs, loop de
// polling en la máquina de desarrollo); STAGING/PRODUCTION -> GitHub Actions
// (workflow_dispatch, disparado más abajo en POST). Derivado, nunca un
// input independiente - no existe combinación válida donde el executor no
// se siga directamente del entorno resuelto arriba.
export function resolveRefreshExecutorType(environment: DataRefreshEnvironment): DataRefreshExecutorType {
  return environment === "LOCAL" ? "LOCAL" : "GITHUB";
}

// Blocker de revisión de producto - "retry del dispatch no funciona con
// replay": ni result.status ("QUEUED" vs "ALREADY_RUNNING", generado por
// fn_start_refresh_run) ni result.replay (idempotencia, con un
// response_snapshot CONGELADO en el momento de la creación original)
// reflejan el estado REAL y ACTUAL de la fila en este instante - un replay
// de idempotencia repite para siempre el snapshot original con
// status:"QUEUED" aunque la corrida ya haya avanzado a RUNNING/SUCCEEDED
// hace rato; ALREADY_RUNNING agrupa QUEUED/CLAIMED/RUNNING bajo la misma
// etiqueta genérica. Confiar en cualquiera de los dos para decidir si
// reintentar el dispatch es exactamente el bug reportado. En cambio: se
// relee el status VIVO de la fila justo antes de decidir - dispara
// (o reintenta) el dispatch si y solo si sigue QUEUED en este instante,
// sin importar si esta llamada a fn_start_refresh_run fue una corrida
// nueva, un replay de idempotencia, o un ALREADY_RUNNING apuntando a una
// corrida previa. Una pequeña carrera acá (relee QUEUED, pero para cuando
// el POST a GitHub llega alguien más ya la reclamó) es inocua a propósito:
// pipeline.fn_claim_refresh_run_by_id (sql/110) solo permite que UN
// workflow la reclame de verdad - un dispatch "de más" simplemente
// encuentra la fila ya no reclamable y termina limpio (ver
// scripts/pipeline/run-data-refresh.mjs). Esa es la garantía real; esta
// relectura solo evita el caso obvio (RUNNING/SUCCEEDED/FAILED ya resuelto)
// de disparar un workflow que de entrada no tiene nada que reclamar.
async function liveRefreshRunStatus(refreshRunId: string): Promise<string | null> {
  const rows = await runGovernanceQuery<{ status: string }>(
    "pipeline_requester",
    "SELECT status FROM pipeline.refresh_runs WHERE refresh_run_id = $1",
    [refreshRunId]
  );
  return rows[0]?.status ?? null;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginForMutation(request);
  if (originError) return originError;

  // Resuelto ANTES de leer el body: el destino nunca depende de lo que
  // envíe el cliente (ver resolveRefreshEnvironment más arriba). Un
  // NEXUS_REFRESH_ENVIRONMENT inválido es un error de configuración del
  // deployment, nunca del usuario - handleApiError nunca filtra el mensaje
  // crudo de más abajo hacia afuera en producción.
  let environment: DataRefreshEnvironment;
  let executorType: DataRefreshExecutorType;
  try {
    environment = resolveRefreshEnvironment();
    executorType = resolveRefreshExecutorType(environment);
  } catch (error) {
    return handleApiError(error);
  }

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

  // environment/executorType NUNCA se leen de `body` (StartRequestBody ni
  // siquiera declara esos campos) - si un cliente viejo o manipulado los
  // envía igual, se ignoran por completo, nunca se validan ni se usan.
  const { mode, confirmed, reason } = body;

  if (typeof mode !== "string" || !MODES.includes(mode as (typeof MODES)[number])) {
    return NextResponse.json({ error: `mode debe ser uno de ${MODES.join(", ")}.`, code: "VALIDATION_ERROR" }, { status: 400 });
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

    // Dispara (o reintenta) GitHub Actions para CUALQUIER corrida GITHUB que
    // siga QUEUED en este instante - nunca para LOCAL (ese camino lo cubre
    // scripts/pipeline/local-refresh-worker.mjs por polling) y nunca bloquea
    // este request esperando a que el pipeline termine (requisito E). Ver
    // liveRefreshRunStatus más arriba para por qué se relee en vez de
    // confiar en result.status/result.replay. Un fallo del dispatch NUNCA
    // se oculta: se registra en el propio log del servidor (nunca el
    // token) y se devuelve en el campo `dispatch` de la respuesta, sin
    // convertir el 202 en un error HTTP (la fila QUEUED ya es real y válida
    // aunque el dispatch falle - la recuperación es un reintento del propio
    // POST, que este mismo mecanismo ahora sí atiende, o un workflow_dispatch
    // manual sin refresh_run_id que reclama esa misma fila QUEUED).
    if (result?.refreshRunId && executorType === "GITHUB") {
      const liveStatus = await liveRefreshRunStatus(result.refreshRunId);
      if (liveStatus === "QUEUED") {
        const dispatch = await dispatchDataRefreshWorkflow({
          environment,
          mode,
          confirmed: confirmed ?? false,
          reason: reason ?? null,
          refreshRunId: result.refreshRunId
        });
        if (!dispatch.ok) {
          console.error(`[data-refresh] dispatch de GitHub Actions falló para refresh_run_id=${result.refreshRunId}: ${dispatch.reason}`);
        }
        result.dispatch = dispatch;
      }
    }

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
    // Lectura, no escritura - capability data:refresh:observe ya la exige
    // arriba, así que un ?environment= explícito para observar OTRO entorno
    // (ej. panel de auditoría) no es un problema de autorización como sí lo
    // sería en POST. Pero sin ese query param, el default NUNCA es "sin
    // filtro" (mezclaría corridas de cualquier entorno) ni un valor público
    // hardcodeado en el cliente - usa el mismo resolveRefreshEnvironment()
    // server-side que POST, así el widget de la UI (que ya no envía
    // environment) automáticamente ve el entorno real de este deployment.
    const environment = request.nextUrl.searchParams.get("environment") ?? resolveRefreshEnvironment();
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
