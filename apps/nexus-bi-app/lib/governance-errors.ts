import { NextResponse } from "next/server";

// Gate B (B9): contrato de errores de comandos de gobierno - las funciones
// SECURITY DEFINER de sql/090/092/094/095 señalan estas condiciones vía
// RAISE EXCEPTION con un mensaje que empieza por el código exacto (nunca se
// interpola contenido de usuario en la posición del código, así que el
// prefijo siempre es seguro de matchear). node-postgres expone esto como un
// Error con .message = el texto del RAISE (más contexto de PL/pgSQL
// concatenado, por eso se usa startsWith/comparación exacta del PREFIJO, no
// igualdad estricta del mensaje completo).
interface PgErrorLike {
  message: string;
  code?: string;
}

export interface GovernanceCommandErrorBody {
  error: string;
  code: string;
}

export interface MappedGovernanceError {
  status: number;
  body: GovernanceCommandErrorBody;
}

export function mapGovernanceFunctionError(error: unknown): MappedGovernanceError | null {
  const pgError = error as PgErrorLike;
  const message = pgError?.message ?? "";

  if (message === "REASON_REQUIRED" || message.startsWith("REASON_REQUIRED")) {
    return { status: 400, body: { error: "Se requiere una razón para este comando.", code: "REASON_REQUIRED" } };
  }
  if (message.startsWith("CONFIRMATION_REQUIRED")) {
    return { status: 400, body: { error: message, code: "CONFIRMATION_REQUIRED" } };
  }
  if (message.startsWith("VALIDATION_ERROR")) {
    return { status: 400, body: { error: message, code: "VALIDATION_ERROR" } };
  }
  if (message === "IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY") {
    return {
      status: 409,
      body: { error: "La misma Idempotency-Key se usó antes con un body distinto.", code: "IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY" }
    };
  }
  if (message.startsWith("VERSION_CONFLICT")) {
    return { status: 409, body: { error: message, code: "VERSION_CONFLICT" } };
  }
  if (message.startsWith("NOT_FOUND")) {
    return { status: 404, body: { error: message, code: "NOT_FOUND" } };
  }

  return null;
}

export function governanceErrorResponse(mapped: MappedGovernanceError): NextResponse {
  return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
}

// B59: los intentos rechazados/fallidos se registran FUERA de la transacción
// que falló (esa ya hizo ROLLBACK) - vía la función mínima
// fn_record_command_attempt, con el rol dedicado nexus_command_attempt_logger
// (sin acceso a issues/correction_versions/command_events). Nunca se
// propaga un error de logging como el error real de la request - si el
// logger falla, se registra en consola servidor y se continúa respondiendo
// el error original al cliente.
export async function recordCommandAttempt(params: {
  correlationId: string;
  commandType: string;
  actorUserId: string;
  errorCode: string;
}): Promise<void> {
  try {
    const { runGovernanceQuery } = await import("./governance-db");
    await runGovernanceQuery(
      "command_attempt_logger",
      "SELECT governance.fn_record_command_attempt($1::uuid, $2, 'HUMAN', $3::uuid, NULL, $4, $5)",
      [params.correlationId, params.commandType, params.actorUserId, "REJECTED", params.errorCode]
    );
  } catch (loggingError) {
    console.error("No se pudo registrar el intento fallido en governance.command_attempts:", loggingError);
  }
}
