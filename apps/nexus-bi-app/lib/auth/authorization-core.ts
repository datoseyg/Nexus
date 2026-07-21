import type { NexusRole, PublicNexusIdentity } from "./identity.ts";

export interface AuthUserLike {
  id: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface AuthenticationSnapshot {
  user: AuthUserLike | null;
  error: unknown;
}

export type NexusUser = PublicNexusIdentity & { id: string };

export type AuthenticationDecision =
  | { ok: true; user: NexusUser }
  | { ok: false; status: 401 | 403 };

const READ_ROLES: readonly NexusRole[] = ["gerencia", "administracion"];

function isNexusRole(value: unknown): value is NexusRole {
  return value === "gerencia" || value === "administracion";
}

function roleLabel(role: NexusRole): PublicNexusIdentity["label"] {
  return role === "gerencia" ? "Gerencia" : "Administración";
}

export function evaluateAuthentication(
  snapshot: AuthenticationSnapshot,
  allowedRoles: readonly NexusRole[] = READ_ROLES
): AuthenticationDecision {
  if (snapshot.error || !snapshot.user) return { ok: false, status: 401 };

  const role = snapshot.user.app_metadata?.nexus_role;
  if (!isNexusRole(role) || !allowedRoles.includes(role)) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    user: {
      id: snapshot.user.id,
      role,
      label: roleLabel(role)
    }
  };
}
