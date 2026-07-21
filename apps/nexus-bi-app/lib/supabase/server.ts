import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabasePublicConfig } from "./config";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = readSupabasePublicConfig(process.env);

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Los Server Components no pueden escribir cookies. proxy.ts se
          // encarga de renovar la sesión antes del render.
        }
      }
    }
  });
}
