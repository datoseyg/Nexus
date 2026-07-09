import { NextResponse } from "next/server";
import { DuckDbLockedError, DuckDbNotFoundError } from "./duckdb";
import { DbConnectionError, DbNotFoundError } from "./db";

// Maneja errores de ambos backends (DuckDB y Postgres) a propósito -
// conviven durante la migración gradual (Fase 4: cutover mecánico de
// rutas existentes, una por una, no todas de una vez).
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof DuckDbLockedError) {
    return NextResponse.json({ error: error.message, code: "DB_LOCKED" }, { status: 503 });
  }

  if (error instanceof DuckDbNotFoundError) {
    return NextResponse.json({ error: error.message, code: "DB_NOT_FOUND" }, { status: 503 });
  }

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
