interface SupabaseEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  [key: string]: string | undefined;
}

export function readSupabasePublicConfig(environment: SupabaseEnvironment): {
  url: string;
  publishableKey: string;
} {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el entorno."
    );
  }

  return { url, publishableKey };
}
