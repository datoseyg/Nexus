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
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof DbConnectionError) {
    return NextResponse.json({ error: error.message, code: "DB_CONNECTION_ERROR" }, { status: 503 });
  }

  if (error instanceof DbNotFoundError) {
    return NextResponse.json({ error: error.message, code: "DB_NOT_FOUND" }, { status: 503 });
  }

  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error("API error:", error);

  return NextResponse.json({ error: message, code: "QUERY_ERROR" }, { status: 400 });
}
