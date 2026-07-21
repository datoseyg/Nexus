import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERIC_LOGIN_ERROR,
  GENERIC_LOGOUT_ERROR,
  performLogin,
  performLogout
} from "../../lib/auth/login-service.ts";

const identityConfiguration = {
  gerenciaEmail: "gerencia@example.invalid",
  administracionEmail: "administracion@example.invalid"
};

test("login válido transforma el ID en servidor y conserva un returnTo interno", async () => {
  const calls: Array<{ email: string; password: string }> = [];
  const result = await performLogin(
    {
      visibleId: "GERENCIA",
      password: "test-secret",
      returnTo: "/dashboard/fieldbeat"
    },
    identityConfiguration,
    {
      async signInWithPassword(credentials) {
        calls.push(credentials);
        return {
          data: { user: { id: "user-1", app_metadata: { nexus_role: "gerencia" } } },
          error: null
        };
      }
    }
  );

  assert.deepEqual(calls, [{ email: "gerencia@example.invalid", password: "test-secret" }]);
  assert.deepEqual(result, { ok: true, redirectTo: "/dashboard/fieldbeat" });
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
  assert.equal(JSON.stringify(result).includes("gerencia@example.invalid"), false);
});

test("ID desconocido devuelve error genérico sin llamar Supabase", async () => {
  let called = false;
  const result = await performLogin(
    { visibleId: "DIRECCION", password: "test-secret", returnTo: null },
    identityConfiguration,
    {
      async signInWithPassword() {
        called = true;
        return { data: { user: { id: "user-1", app_metadata: { nexus_role: "gerencia" } } }, error: null };
      }
    }
  );

  assert.equal(called, false);
  assert.deepEqual(result, { ok: false, error: GENERIC_LOGIN_ERROR });
});

test("contraseña incorrecta oculta el error interno de Supabase", async () => {
  const result = await performLogin(
    { visibleId: "ADMINISTRACION", password: "wrong-secret", returnTo: null },
    identityConfiguration,
    {
      async signInWithPassword() {
        return { data: null, error: new Error("Invalid login credentials for technical@example.invalid") };
      }
    }
  );

  assert.deepEqual(result, { ok: false, error: GENERIC_LOGIN_ERROR });
  assert.equal(JSON.stringify(result).includes("technical@example.invalid"), false);
  assert.equal(JSON.stringify(result).includes("wrong-secret"), false);
});

test("returnTo externo se reemplaza por inicio", async () => {
  const result = await performLogin(
    { visibleId: "GERENCIA", password: "test-secret", returnTo: "https://evil.example" },
    identityConfiguration,
    {
      async signInWithPassword() {
        return {
          data: { user: { id: "user-1", app_metadata: { nexus_role: "gerencia" } } },
          error: null
        };
      }
    }
  );

  assert.deepEqual(result, { ok: true, redirectTo: "/" });
});

test("credenciales válidas sin nexus_role autorizado no completan el login", async () => {
  const result = await performLogin(
    { visibleId: "GERENCIA", password: "test-secret", returnTo: null },
    identityConfiguration,
    {
      async signInWithPassword() {
        return { data: { user: { id: "user-1", app_metadata: {} } }, error: null };
      }
    }
  );

  assert.deepEqual(result, { ok: false, error: GENERIC_LOGIN_ERROR });
});

test("logout invalida la sesión local y dirige a login", async () => {
  const scopes: string[] = [];
  const result = await performLogout({
    async signOut(options) {
      scopes.push(options.scope);
      return { error: null };
    }
  });

  assert.deepEqual(scopes, ["local"]);
  assert.deepEqual(result, { ok: true, redirectTo: "/login" });
});

test("logout no anuncia éxito cuando Supabase no pudo cerrar la sesión", async () => {
  const result = await performLogout({
    async signOut() {
      return { error: new Error("internal technical failure") };
    }
  });

  assert.deepEqual(result, { ok: false, error: GENERIC_LOGOUT_ERROR });
  assert.equal(JSON.stringify(result).includes("internal technical failure"), false);
});
