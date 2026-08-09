import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySupabaseRuntimeError,
  createInfrastructureErrorResponse,
  reportSupabaseRuntimeError,
  resetSupabaseRuntimeErrorLogForTests
} from "../../lib/supabase/runtime-error.ts";

test("clasifica ECONNREFUSED anidado como backend local no disponible", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54321"), { code: "ECONNREFUSED" })
  });
  assert.equal(classifySupabaseRuntimeError(error), "CONNECTION_REFUSED");
});

test("distingue timeout, autorización HTTP y respuesta inválida", () => {
  assert.equal(classifySupabaseRuntimeError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), "TIMEOUT");
  assert.equal(classifySupabaseRuntimeError({ status: 401 }), "HTTP_AUTH");
  assert.equal(classifySupabaseRuntimeError({ status: 403 }), "HTTP_AUTH");
  assert.equal(classifySupabaseRuntimeError(new SyntaxError("Unexpected token")), "INVALID_RESPONSE");
  assert.equal(classifySupabaseRuntimeError(new Error("syntax error at or near SELECT")), "OTHER");
});

test("deduplica logs equivalentes por subsistema y conserva request_id", () => {
  resetSupabaseRuntimeErrorLogForTests();
  const lines: string[] = [];
  const logger = (line: string) => lines.push(line);
  const error = Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" });

  const first = reportSupabaseRuntimeError(error, {
    subsystem: "auth-proxy",
    backendUrl: "http://127.0.0.1:54321/path?secret=no",
    logger,
    requestId: "req-one",
    nowMs: 1000
  });
  const second = reportSupabaseRuntimeError(error, {
    subsystem: "auth-proxy",
    backendUrl: "http://127.0.0.1:54321/path?secret=no",
    logger,
    requestId: "req-two",
    nowMs: 1001
  });

  assert.equal(first?.requestId, "req-one");
  assert.equal(second?.requestId, "req-two");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /request_id=req-one/);
  assert.match(lines[0], /http:\/\/127\.0\.0\.1:54321/);
  assert.doesNotMatch(lines[0], /secret=no/);
});

test("respuesta 503 informa infraestructura sin exponer secretos", async () => {
  const response = createInfrastructureErrorResponse({
    requestId: "abcd1234",
    backendUrl: "http://127.0.0.1:54321/private?token=hidden"
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "LOCAL_BACKEND_UNAVAILABLE");
  assert.equal(body.requestId, "abcd1234");
  assert.match(body.error, /npm run dev:local/);
  assert.doesNotMatch(JSON.stringify(body), /token=hidden/);
});

