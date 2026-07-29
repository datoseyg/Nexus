import type { NexusRole } from "./identity.ts";
import { requireRole, NexusAuthorizationError, type AuthenticatedUserProvider } from "./authorization";
import type { NexusUser } from "./authorization-core";
import { runGovernanceQuery } from "../governance-db";

// Gate B (B10/B11): las rutas de comando nunca acoplan autorización al
// nombre del rol (`requireRole(["administracion"])` a secas) - verifican una
// capacidad nombrada contra governance.role_capabilities, que es la única
// fuente de verdad del mapeo rol->capacidad (cambiable sin redeploy vía un
// comando administrativo futuro, fuera del alcance de este corte). Esto es
// SOLO el primer filtro (capa de aplicación) - la autoridad real sigue
// siendo el rol de conexión PostgreSQL + su GRANT EXECUTE (B34); esta función
// nunca reemplaza eso, solo evita abrir la conexión de escritura cuando el
// usuario ya no califica.
const ALL_ROLES: readonly NexusRole[] = ["gerencia", "administracion"];

export async function requireCapability(
  capability: string,
  provider?: AuthenticatedUserProvider
): Promise<NexusUser> {
  const user = await requireRole(ALL_ROLES, provider);

  const rows = await runGovernanceQuery<{ exists: number }>(
    "app_read",
    "SELECT 1 AS exists FROM governance.role_capabilities WHERE role = $1 AND capability = $2",
    [user.role, capability]
  );

  if (rows.length === 0) {
    throw new NexusAuthorizationError(403);
  }

  return user;
}

export { NexusAuthorizationError };
