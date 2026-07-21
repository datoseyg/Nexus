import assert from "node:assert/strict";
import test from "node:test";
import {
  NexusAuthorizationError,
  requireAuthenticatedUser,
  requireReadApiAccess,
  requireRole,
  setAuthorizationProviderForTests
} from "../../lib/auth/authorization.ts";
import type { AuthUserLike } from "../../lib/auth/authorization-core.ts";

function provider(user: AuthUserLike | null, error: unknown = null) {
  return {
    async getUser() {
      return { user, error };
    }
  };
}

test("requireAuthenticatedUser rechaza ausencia de sesión con 401", async () => {
  await assert.rejects(
    () => requireAuthenticatedUser(provider(null)),
    (error: unknown) => error instanceof NexusAuthorizationError && error.status === 401
  );
});

test("requireAuthenticatedUser trata sesión vencida como 401", async () => {
  await assert.rejects(
    () => requireAuthenticatedUser(provider(null, new Error("expired"))),
    (error: unknown) => error instanceof NexusAuthorizationError && error.status === 401
  );
});

test("requireRole rechaza rol desconocido con 403", async () => {
  await assert.rejects(
    () =>
      requireRole(
        ["gerencia", "administracion"],
        provider({ id: "user-1", app_metadata: { nexus_role: "desconocido" } })
      ),
    (error: unknown) => error instanceof NexusAuthorizationError && error.status === 403
  );
});

test("requireRole devuelve una identidad pública válida", async () => {
  const user = await requireRole(
    ["gerencia", "administracion"],
    provider({ id: "user-1", app_metadata: { nexus_role: "gerencia" } })
  );

  assert.deepEqual(user, { id: "user-1", role: "gerencia", label: "Gerencia" });
});

test("API sin sesión obtiene JSON 401, nunca redirect HTML", async () => {
  const response = await requireReadApiAccess(provider(null));

  assert.equal(response?.status, 401);
  assert.equal(response?.headers.get("content-type")?.includes("application/json"), true);
  assert.deepEqual(await response?.json(), { error: "Unauthorized", code: "UNAUTHORIZED" });
});

test("API con usuario sin rol obtiene JSON 403", async () => {
  const response = await requireReadApiAccess(provider({ id: "user-1", app_metadata: {} }));

  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { error: "Forbidden", code: "FORBIDDEN" });
});

test("API con Gerencia o Administración continúa al handler", async () => {
  for (const nexusRole of ["gerencia", "administracion"]) {
    const response = await requireReadApiAccess(
      provider({ id: `user-${nexusRole}`, app_metadata: { nexus_role: nexusRole } })
    );
    assert.equal(response, null);
  }
});

test("el seam de integración autoriza mediante provider solo bajo NODE_ENV=test", async () => {
  try {
    setAuthorizationProviderForTests(
      provider({ id: "integration-user", app_metadata: { nexus_role: "gerencia" } })
    );
    assert.equal(await requireReadApiAccess(), null);
  } finally {
    setAuthorizationProviderForTests(null);
  }
});
