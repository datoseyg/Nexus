import { NextResponse } from "next/server";
import type { NexusRole } from "./identity.ts";
import {
  evaluateAuthentication,
  type AuthUserLike,
  type NexusUser
} from "./authorization-core.ts";
import { hasSupabaseAuthCookie } from "./session-cookie.ts";

export interface AuthenticatedUserProvider {
  getUser(): Promise<{ user: AuthUserLike | null; error: unknown }>;
}

let integrationTestProvider: AuthenticatedUserProvider | null = null;

export function setAuthorizationProviderForTests(
  provider: AuthenticatedUserProvider | null
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("El provider de autorización de pruebas solo está disponible bajo NODE_ENV=test.");
  }
  integrationTestProvider = provider;
}

const READ_ROLES: readonly NexusRole[] = ["gerencia", "administracion"];

export class NexusAuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403) {
    super(status === 401 ? "Unauthorized" : "Forbidden");
    this.name = "NexusAuthorizationError";
    this.status = status;
  }
}

export async function requireAuthenticatedUser(
  provider?: AuthenticatedUserProvider
): Promise<NexusUser> {
  return requireRole(READ_ROLES, provider);
}

export async function requireRole(
  allowedRoles: readonly NexusRole[],
  provider?: AuthenticatedUserProvider
): Promise<NexusUser> {
  const resolvedProvider = provider
    ?? integrationTestProvider
    ?? (await createSupabaseUserProvider());
  const snapshot = await resolvedProvider.getUser();
  const decision = evaluateAuthentication(snapshot, allowedRoles);

  if (!decision.ok) throw new NexusAuthorizationError(decision.status);
  return decision.user;
}

export async function requireReadApiAccess(
  provider?: AuthenticatedUserProvider
): Promise<NextResponse | null> {
  try {
    await requireRole(READ_ROLES, provider);
    return null;
  } catch (error) {
    const status = error instanceof NexusAuthorizationError ? error.status : 401;
    const body = status === 401
      ? { error: "Unauthorized", code: "UNAUTHORIZED" }
      : { error: "Forbidden", code: "FORBIDDEN" };

    return NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" }
    });
  }
}

async function createSupabaseUserProvider(): Promise<AuthenticatedUserProvider> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  if (!hasSupabaseAuthCookie(cookieStore.getAll())) {
    return {
      async getUser() {
        return { user: null, error: null };
      }
    };
  }

  const { createClient } = await import("@/lib/supabase/server");
  const client = await createClient();

  return {
    async getUser() {
      const { data, error } = await client.auth.getUser();
      return { user: data.user, error };
    }
  };
}
