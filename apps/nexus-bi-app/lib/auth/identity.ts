export type NexusRole = "gerencia" | "administracion";

export interface PublicNexusIdentity {
  role: NexusRole;
  label: "Gerencia" | "Administración";
}

export interface IdentityConfiguration {
  gerenciaEmail: string;
  administracionEmail: string;
}

export interface ResolvedVisibleIdentity {
  email: string;
  publicIdentity: PublicNexusIdentity;
}

export class VisibleIdentityError extends Error {
  constructor() {
    super("Visible identity is not allowed or configured");
    this.name = "VisibleIdentityError";
  }
}

export function resolveVisibleIdentity(
  visibleId: string,
  configuration: IdentityConfiguration
): ResolvedVisibleIdentity {
  if (visibleId === "GERENCIA") {
    if (!configuration.gerenciaEmail) throw new VisibleIdentityError();
    return {
      email: configuration.gerenciaEmail,
      publicIdentity: { role: "gerencia", label: "Gerencia" }
    };
  }

  if (visibleId === "ADMINISTRACION") {
    if (!configuration.administracionEmail) throw new VisibleIdentityError();
    return {
      email: configuration.administracionEmail,
      publicIdentity: { role: "administracion", label: "Administración" }
    };
  }

  throw new VisibleIdentityError();
}
