"use server";

import { redirect } from "next/navigation";
import {
  performLogin,
  performLogout,
  GENERIC_LOGIN_ERROR,
  GENERIC_LOGOUT_ERROR
} from "@/lib/auth/login-service";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";
import type {
  LoginActionState,
  LogoutActionState,
} from "./action-state";
import { formString } from "@/lib/form";

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  let result: Awaited<ReturnType<typeof performLogin>>;

  try {
    const supabase = await createClient();
    result = await performLogin(
      {
        visibleId: formString(formData, "userId", 32),
        password: formString(formData, "password", 1024),
        returnTo: formString(formData, "returnTo", 2048)
      },
      {
        gerenciaEmail: process.env.NEXUS_AUTH_GERENCIA_EMAIL ?? "",
        administracionEmail: process.env.NEXUS_AUTH_ADMINISTRACION_EMAIL ?? ""
      },
      supabase.auth
    );
  } catch {
    return { error: GENERIC_LOGIN_ERROR };
  }

  if (!result.ok) return { error: result.error };

  redirect(result.redirectTo);
}

export async function logoutAction(
  _previousState: LogoutActionState
): Promise<LogoutActionState> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { error: GENERIC_LOGOUT_ERROR };
  }

  try {
    await requireAuthenticatedUser({
      async getUser() {
        const { data, error } = await supabase.auth.getUser();
        return { user: data.user, error };
      }
    });
  } catch {
    // Aunque la sesión haya vencido, signOut debe limpiar sus cookies.
  }

  const result = await performLogout(supabase.auth);
  if (!result.ok) return { error: result.error };

  redirect(result.redirectTo);
}
