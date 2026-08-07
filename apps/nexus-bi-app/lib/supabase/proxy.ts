import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { evaluateAuthentication } from "@/lib/auth/authorization-core";
import { hasSupabaseAuthCookie } from "@/lib/auth/session-cookie";
import { readSupabasePublicConfig } from "./config";
import {
  createInfrastructureErrorResponse,
  reportSupabaseRuntimeError
} from "./runtime-error";

function copyAuthResponse(source: NextResponse, target: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
  return target;
}

export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  isAuthorized: boolean;
}> {
  let response = NextResponse.next({ request });
  if (!hasSupabaseAuthCookie(request.cookies.getAll())) {
    return { response, isAuthorized: false };
  }

  const { url, publishableKey } = readSupabasePublicConfig(process.env);
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headersToSet)) {
          response.headers.set(name, value);
        }
      }
    }
  });

  let data;
  let error;
  try {
    ({ data, error } = await supabase.auth.getUser());
  } catch (runtimeError) {
    const incident = reportSupabaseRuntimeError(runtimeError, {
      subsystem: "auth-proxy",
      backendUrl: url
    });
    if (!incident) throw runtimeError;
    return {
      response: createInfrastructureErrorResponse({
        requestId: incident.requestId,
        backendUrl: url,
        requestPath: request.nextUrl.pathname
      }),
      isAuthorized: false
    };
  }
  const decision = evaluateAuthentication({ user: data.user, error });
  return { response, isAuthorized: decision.ok };
}

export function redirectWithAuthCookies(
  request: NextRequest,
  authResponse: NextResponse,
  location: string
): NextResponse {
  return copyAuthResponse(authResponse, NextResponse.redirect(new URL(location, request.url)));
}
