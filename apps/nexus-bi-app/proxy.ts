import { NextResponse, type NextRequest } from "next/server";
import { decideRouteAccess } from "@/lib/auth/route-policy";
import { redirectWithAuthCookies, updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.next();
  }

  const { response, isAuthorized } = await updateSession(request);
  const decision = decideRouteAccess(request.nextUrl.pathname, isAuthorized);

  if (decision.action === "redirect") {
    return redirectWithAuthCookies(request, response, decision.location);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
