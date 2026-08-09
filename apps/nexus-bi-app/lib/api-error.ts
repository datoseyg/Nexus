import { NextResponse } from "next/server";
import { DbConnectionError, DbNotFoundError } from "./db";

// NO importar nada de "./duckdb" acá arriba, aunque sea solo para 2 clases
// de error. handleApiError() lo usan TODAS las rutas sin excepción - un
// import de lib/duckdb.ts en este archivo arrastra @duckdb/node-api (y su
// binario nativo libduckdb.so) al bundle de CADA función serverless. En
// Netlify ese binario no carga ("Failed to load external module
// @duckdb/node-api: libduckdb.so: cannot open shared object file") y
// tumbaba el 100% de /api/** con 500 antes de que corriera una sola línea
// de nuestro código - no fallaba en local porque Windows sí lo resuelve
// bien. lib/duckdb.ts en sí sigue intacto (nadie lo borró, sigue
// disponible para quien lo importe directo si hace falta desarrollo local
// sin Supabase) - lo que no puede pasar es que sea una dependencia
// transitiva de algo que usan todas las rutas.
// Sección 7/9 del encargo NEXUS V3 - un request_id corto y opaco (nunca un
// dato sensible) que el frontend puede mostrar/loguear junto al error, para
// poder correlacionar "el usuario vio este mensaje" con "esta línea del log
// del servidor" sin tener que imprimir la query ni parámetros completos acá.
function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function handleApiError(error: unknown): NextResponse {
  const requestId = newRequestId();

  if (error instanceof DbConnectionError) {
    console.error(`[api] request_id=${requestId} DB_CONNECTION_ERROR: ${error.message}`);
    return NextResponse.json({ error: error.message, code: "DB_CONNECTION_ERROR", requestId }, { status: 503 });
  }

  if (error instanceof DbNotFoundError) {
    console.error(`[api] request_id=${requestId} DB_NOT_FOUND: ${error.message}`);
    return NextResponse.json({ error: error.message, code: "DB_NOT_FOUND", requestId }, { status: 503 });
  }

  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error(`[api] request_id=${requestId} QUERY_ERROR:`, error);

  return NextResponse.json({ error: message, code: "QUERY_ERROR", requestId }, { status: 400 });
}
