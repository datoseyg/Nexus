import { NextResponse, type NextRequest } from "next/server";

// Gate B (B12/B18): las 10 rutas admin actuales no validan Origin/Host en
// absoluto - antes de exponer cualquier comando de escritura nuevo, cada
// mutación lo hace explícitamente. SameSite=Lax (default de la cookie de
// sesión Supabase) ya mitiga CSRF cross-site para requests simples, pero
// esto es una capa adicional de defensa en profundidad, no un reemplazo -
// nunca se asume que SameSite solo alcanza. Compara el header Origin (o
// Referer como fallback) contra el propio origin de la request
// (request.nextUrl.origin refleja el host real por el que Next.js recibió
// la petición, incluido detrás de un proxy que reescriba Host correctamente)
// - ausente o distinto en una mutación => 403 FORBIDDEN. Nunca se exige en
// GET.
function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function firstForwardedHost(value: string | null): string | null {
  if (!value) return null;
  return value.split(",")[0]?.trim().toLowerCase() || null;
}

export function requireSameOriginForMutation(request: NextRequest): NextResponse | null {
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  // Origin tiene prioridad. Referer solo se usa como fallback cuando Origin
  // no existe. Nunca se confía en request.nextUrl.origin como origen público:
  // detrás de proxies/serverless puede representar una URL interna.
  const candidateHeader = originHeader ?? refererHeader;
  const candidateHost = candidateHeader ? hostFromUrl(candidateHeader) : null;

  // Mismo criterio que la protección CSRF de Next.js para requests
  // reenviadas: x-forwarded-host representa el host público original y
  // Host queda como fallback para desarrollo local / runtimes sin proxy.
  const forwardedHost = firstForwardedHost(request.headers.get("x-forwarded-host"));
  const host = request.headers.get("host")?.trim().toLowerCase() || null;

  const sameHost =
    candidateHost !== null &&
    (
      (forwardedHost !== null && candidateHost === forwardedHost) ||
      (host !== null && candidateHost === host)
    );

  if (!sameHost) {
    return NextResponse.json(
      { error: "Origin ausente o no coincide con el host esperado.", code: "FORBIDDEN" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return null;
}
