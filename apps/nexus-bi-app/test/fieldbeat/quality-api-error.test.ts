import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApiError } from "../../lib/api-error.ts";
import { DbConnectionError, DbNotFoundError } from "../../lib/db.ts";

// Contrato de error compartido por overview/quality/filters (Phase 2 §9:
// "errores tipados"). No hay una suite dedicada previa para handleApiError
// - se agrega acá porque los 2 endpoints nuevos dependen de que este mapeo
// sea estable y nunca filtre detalles de conexión (host/usuario/password)
// en la respuesta HTTP.

test("DbConnectionError mapea a 503 DB_CONNECTION_ERROR", async () => {
  const res = handleApiError(new DbConnectionError("No se pudo conectar a Supabase Postgres: timeout"));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "DB_CONNECTION_ERROR");
});

test("DbNotFoundError mapea a 503 DB_NOT_FOUND", async () => {
  const res = handleApiError(new DbNotFoundError("no encontrado"));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "DB_NOT_FOUND");
});

test("un Error genérico (ej. error de sintaxis SQL) mapea a 400 QUERY_ERROR, nunca 500 silencioso", async () => {
  const res = handleApiError(new Error("syntax error at or near \"FORM\""));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "QUERY_ERROR");
});

test("un valor no-Error (throw de un string) no revienta el handler", async () => {
  const res = handleApiError("algo raro");
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "QUERY_ERROR");
  assert.equal(body.error, "Error desconocido");
});
