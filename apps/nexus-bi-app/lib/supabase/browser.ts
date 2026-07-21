"use client";

import { createBrowserClient } from "@supabase/ssr";
import { readSupabasePublicConfig } from "./config";

export function createClient() {
  const { url, publishableKey } = readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  });
  return createBrowserClient(url, publishableKey);
}
