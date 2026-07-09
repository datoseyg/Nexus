import { NextRequest, NextResponse } from "next/server";

// Protege las rutas app/api/admin/** para llamadores SERVER-TO-SERVER:
// scripts del pipeline (src/db/*.js, src/qa/*.js posteando a
// audit.pipeline_runs/data_quality_events desde Node) y uso manual vía
// curl/Postman por el equipo interno. NO es un mecanismo de autenticación
// de usuario — a propósito no hay ningún wiring de UI pública contra estas
// rutas todavía (ver Fase 5 del plan de migración): un shared-secret token
// oculto detrás de un botón sigue siendo alcanzable por cualquiera que abra
// la página, así que eso queda bloqueado hasta que exista login real,
// cookie de sesión admin, o middleware equivalente.
//
// NEXUS_ADMIN_TOKEN es server-only, sin excepción: nunca con prefijo
// NEXT_PUBLIC_, nunca leído desde un archivo "use client".
const HEADER_NAME = "x-nexus-admin-token";

export function requireAdminToken(request: NextRequest): NextResponse | null {
  const expected = process.env.NEXUS_ADMIN_TOKEN;

  if (!expected) {
    console.error("NEXUS_ADMIN_TOKEN no está configurado en el entorno — todas las rutas /api/admin/** quedan bloqueadas.");
    return NextResponse.json({ error: "Servidor mal configurado: falta NEXUS_ADMIN_TOKEN", code: "SERVER_MISCONFIGURED" }, { status: 500 });
  }

  const provided = request.headers.get(HEADER_NAME);

  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Token de administración inválido o faltante", code: "UNAUTHORIZED" }, { status: 401 });
  }

  return null;
}
