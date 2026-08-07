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
export function requireSameOriginForMutation(request: NextRequest): NextResponse | null {
  const expectedOrigin = request.nextUrl.origin;
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  const candidate = originHeader ?? (refererHeader ? new URL(refererHeader).origin : null);

  if (!candidate || candidate !== expectedOrigin) {
    return NextResponse.json(
      { error: "Origin ausente o no coincide con el host esperado.", code: "FORBIDDEN" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return null;
}
