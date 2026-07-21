import { resolveVisibleIdentity, type IdentityConfiguration } from "./identity.ts";
import { safeReturnTo } from "./return-to.ts";
import { evaluateAuthentication, type AuthUserLike } from "./authorization-core.ts";

export const GENERIC_LOGIN_ERROR = "No fue posible iniciar sesión. Revisa tus credenciales.";
export const GENERIC_LOGOUT_ERROR = "No fue posible cerrar la sesión. Inténtalo nuevamente.";

interface LoginInput {
  visibleId: string;
  password: string;
  returnTo?: string | null;
}

interface PasswordAuthAdapter {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthUserLike | null } | null;
    error: unknown;
  }>;
}

interface LogoutAuthAdapter {
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
}

export type LoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: typeof GENERIC_LOGIN_ERROR };

export async function performLogin(
  input: LoginInput,
  configuration: IdentityConfiguration,
  auth: PasswordAuthAdapter
): Promise<LoginResult> {
  try {
    const identity = resolveVisibleIdentity(input.visibleId, configuration);
    const { data, error } = await auth.signInWithPassword({
      email: identity.email,
      password: input.password
    });

    if (error) return { ok: false, error: GENERIC_LOGIN_ERROR };

    // Un login válido en Supabase no basta: el destino post-login (p. ej. "/")
    // exige el mismo rol que evaluateAuthentication ya impone en el resto de
    // la app. Si no se valida acá, performLogin devuelve ok:true y redirect()
    // apunta a una ruta que va a rechazar a ese mismo usuario en el acto.
    const authorization = evaluateAuthentication({ user: data?.user ?? null, error: null });
    if (!authorization.ok) return { ok: false, error: GENERIC_LOGIN_ERROR };

    return { ok: true, redirectTo: safeReturnTo(input.returnTo) };
  } catch {
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
}

export async function performLogout(auth: LogoutAuthAdapter): Promise<
  | { ok: true; redirectTo: "/login" }
  | { ok: false; error: typeof GENERIC_LOGOUT_ERROR }
> {
  try {
    const { error } = await auth.signOut({ scope: "local" });
    if (error) return { ok: false, error: GENERIC_LOGOUT_ERROR };
    return { ok: true, redirectTo: "/login" };
  } catch {
    return { ok: false, error: GENERIC_LOGOUT_ERROR };
  }
}
