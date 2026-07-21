import assert from "node:assert/strict";
import test from "node:test";
import { readSupabasePublicConfig } from "../../lib/supabase/config.ts";

test("lee exclusivamente URL y publishable key", () => {
  assert.deepEqual(
    readSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: "never-return-this"
    }),
    {
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test"
    }
  );
});

test("falla cerrada cuando falta configuración sin incluir valores sensibles", () => {
  assert.throws(
    () => readSupabasePublicConfig({}),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("NEXT_PUBLIC_SUPABASE_URL") &&
      error.message.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") &&
      !error.message.includes("service_role")
  );
});
