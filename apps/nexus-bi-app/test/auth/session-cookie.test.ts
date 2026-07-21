import assert from "node:assert/strict";
import test from "node:test";
import { hasSupabaseAuthCookie } from "../../lib/auth/session-cookie.ts";

test("sin cookies Supabase no intenta validar una sesión remota", () => {
  assert.equal(hasSupabaseAuthCookie([]), false);
  assert.equal(hasSupabaseAuthCookie([{ name: "theme", value: "dark" }]), false);
});

test("reconoce cookies de sesión Supabase completas o fragmentadas", () => {
  assert.equal(hasSupabaseAuthCookie([{ name: "sb-project-auth-token", value: "token" }]), true);
  assert.equal(hasSupabaseAuthCookie([{ name: "sb-project-auth-token.0", value: "chunk" }]), true);
});
