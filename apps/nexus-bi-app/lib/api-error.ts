import { NextResponse } from "next/server";
import { DuckDbLockedError, DuckDbNotFoundError } from "./duckdb";

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof DuckDbLockedError) {
    return NextResponse.json({ error: error.message, code: "DB_LOCKED" }, { status: 503 });
  }

  if (error instanceof DuckDbNotFoundError) {
    return NextResponse.json({ error: error.message, code: "DB_NOT_FOUND" }, { status: 503 });
  }

  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error("API error:", error);

  return NextResponse.json({ error: message, code: "QUERY_ERROR" }, { status: 400 });
}
