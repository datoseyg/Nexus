import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuthentication } from "../../lib/auth/authorization-core.ts";

test("sin usuario autenticado devuelve 401", () => {
  assert.deepEqual(evaluateAuthentication({ user: null, error: null }), {
    ok: false,
    status: 401
  });
});

test("una sesión vencida o inválida devuelve 401", () => {
  assert.deepEqual(evaluateAuthentication({ user: null, error: new Error("expired") }), {
    ok: false,
    status: 401
  });
});

test("un usuario válido sin rol confiable devuelve 403", () => {
  assert.deepEqual(
    evaluateAuthentication({
      user: { id: "user-1", app_metadata: {}, user_metadata: { nexus_role: "gerencia" } },
      error: null
    }),
    { ok: false, status: 403 }
  );
});

test("ignora roles enviados por metadata editable del usuario", () => {
  assert.deepEqual(
    evaluateAuthentication({
      user: {
        id: "user-1",
        app_metadata: { nexus_role: "desconocido" },
        user_metadata: { nexus_role: "gerencia" }
      },
      error: null
    }),
    { ok: false, status: 403 }
  );
});

test("Gerencia obtiene acceso de lectura con identidad pública mínima", () => {
  assert.deepEqual(
    evaluateAuthentication({
      user: { id: "user-gerencia", app_metadata: { nexus_role: "gerencia" } },
      error: null
    }),
    {
      ok: true,
      user: { id: "user-gerencia", role: "gerencia", label: "Gerencia" }
    }
  );
});

test("Administración obtiene acceso de lectura", () => {
  assert.deepEqual(
    evaluateAuthentication({
      user: { id: "user-admin", app_metadata: { nexus_role: "administracion" } },
      error: null
    }),
    {
      ok: true,
      user: { id: "user-admin", role: "administracion", label: "Administración" }
    }
  );
});

test("un rol autenticado pero no permitido devuelve 403", () => {
  assert.deepEqual(
    evaluateAuthentication(
      {
        user: { id: "user-admin", app_metadata: { nexus_role: "administracion" } },
        error: null
      },
      ["gerencia"]
    ),
    { ok: false, status: 403 }
  );
});
