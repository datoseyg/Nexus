const SAFE_ORIGIN = "https://nexus.invalid";

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  try {
    const url = new URL(value, SAFE_ORIGIN);
    const decodedPathname = decodeURIComponent(url.pathname);

    if (
      url.origin !== SAFE_ORIGIN ||
      decodedPathname.startsWith("//") ||
      decodedPathname.includes("\\") ||
      decodedPathname === "/login" ||
      decodedPathname.startsWith("/login/")
    ) {
      return "/";
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}
