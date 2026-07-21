export type RouteAccessDecision =
  | { action: "next" }
  | { action: "redirect"; location: string };

function isUnprotectedResource(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname === "/favicon.ico";
}

export function decideRouteAccess(pathname: string, isAuthenticated: boolean): RouteAccessDecision {
  if (pathname.startsWith("/api/") || isUnprotectedResource(pathname)) {
    return { action: "next" };
  }

  if (pathname === "/login") {
    return isAuthenticated ? { action: "redirect", location: "/" } : { action: "next" };
  }

  if (!isAuthenticated) {
    return {
      action: "redirect",
      location: `/login?next=${encodeURIComponent(pathname)}`
    };
  }

  return { action: "next" };
}
