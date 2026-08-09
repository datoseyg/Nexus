import { NextResponse } from "next/server";

export type SupabaseRuntimeErrorKind =
  | "CONNECTION_REFUSED"
  | "TIMEOUT"
  | "HTTP_AUTH"
  | "INVALID_RESPONSE"
  | "OTHER";

const LOG_DEDUP_WINDOW_MS = 60_000;
const lastLogAt = new Map<string, number>();

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return chain;
}

export function classifySupabaseRuntimeError(error: unknown): SupabaseRuntimeErrorKind {
  const chain = errorChain(error);
  for (const item of chain) {
    if (typeof item === "object" && item) {
      const status = "status" in item ? Number((item as { status?: unknown }).status) : NaN;
      if (status === 401 || status === 403) return "HTTP_AUTH";
      const code = "code" in item ? String((item as { code?: unknown }).code) : "";
      if (["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) return "CONNECTION_REFUSED";
      if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ABORT_ERR"].includes(code)) return "TIMEOUT";
    }
    if (item instanceof SyntaxError) return "INVALID_RESPONSE";
    const message = item instanceof Error ? item.message : String(item);
    if (/ECONNREFUSED|connection refused|failed to connect/i.test(message)) return "CONNECTION_REFUSED";
    if (/timed?\s*out|timeout|AbortError/i.test(message)) return "TIMEOUT";
  }
  return "OTHER";
}

function safeOrigin(backendUrl: string): string {
  try {
    return new URL(backendUrl).origin;
  } catch {
    return "backend local configurado";
  }
}

export function reportSupabaseRuntimeError(error: unknown, {
  subsystem,
  backendUrl,
  requestId = crypto.randomUUID().slice(0, 8),
  nowMs = Date.now(),
  logger = console.error
}: {
  subsystem: string;
  backendUrl: string;
  requestId?: string;
  nowMs?: number;
  logger?: (line: string) => void;
}): { kind: "CONNECTION_REFUSED" | "TIMEOUT"; requestId: string } | null {
  const kind = classifySupabaseRuntimeError(error);
  if (kind !== "CONNECTION_REFUSED" && kind !== "TIMEOUT") return null;

  const origin = safeOrigin(backendUrl);
  const key = `${subsystem}:${kind}:${origin}`;
  const previous = lastLogAt.get(key) ?? -Infinity;
  if (nowMs - previous >= LOG_DEDUP_WINDOW_MS) {
    lastLogAt.set(key, nowMs);
    logger(`[nexus-infra] request_id=${requestId} subsystem=${subsystem} kind=${kind} backend=${origin} ` +
      "El backend local no está disponible. Ejecuta desde la raíz: npm run dev:local");
  }
  return { kind, requestId };
}

export function createInfrastructureErrorResponse({
  requestId,
  backendUrl,
  requestPath
}: {
  requestId: string;
  backendUrl: string;
  requestPath?: string;
}): NextResponse {
  const origin = safeOrigin(backendUrl);
  const message = `El backend local de Nexus no está disponible en ${origin}. Ejecuta desde la raíz: npm run dev:local`;
  if (requestPath && !requestPath.startsWith("/api/")) {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Backend local no disponible</title></head><body><main><h1>Backend local no disponible</h1><p>${message}</p><p>request_id: <code>${requestId}</code></p></main></body></html>`;
    return new NextResponse(html, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" }
    });
  }
  return NextResponse.json(
    { error: message, code: "LOCAL_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "Cache-Control": "private, no-store" } }
  );
}

export function resetSupabaseRuntimeErrorLogForTests(): void {
  if (process.env.NODE_ENV === "test") lastLogAt.clear();
}

