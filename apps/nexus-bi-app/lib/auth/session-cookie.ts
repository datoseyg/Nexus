interface CookieNameValue {
  name: string;
  value: string;
}

export function hasSupabaseAuthCookie(cookies: readonly CookieNameValue[]): boolean {
  return cookies.some(cookie =>
    cookie.value.length > 0 && /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(cookie.name)
  );
}
