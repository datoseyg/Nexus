# AUTH-P0 state

## Implemented

- `apps/nexus-bi-app/lib/supabase/browser.ts` and `server.ts`: request-scoped browser/server clients via `@supabase/supabase-js` and `@supabase/ssr`.
- `apps/nexus-bi-app/proxy.ts`: session refresh and page redirects; API contracts remain explicit.
- `apps/nexus-bi-app/app/login/actions.ts` and login UI: Server Action login/logout with safe return-path handling.
- `apps/nexus-bi-app/lib/auth/authorization.ts`: `requireAuthenticatedUser`, `requireRole`, server-only `GERENCIA`/`ADMINISTRACION` resolution and test seam gated to `NODE_ENV=test`.
- Protected pages/layouts, 29 read APIs with 401/403 authorization, and 10 admin APIs retaining `NEXUS_ADMIN_TOKEN` technical protection.
- Shell identity/logout controls and `NEXUS_SHOW_AUDIT=false`, `NEXUS_SHOW_EXPLORER=false` defaults for first release.

Variables are documented by name only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_DB_URL_DIRECT` (admin/migration only), `DATABASE_SSL_MODE`, `NEXUS_AUTH_GERENCIA_EMAIL`, `NEXUS_AUTH_ADMINISTRACION_EMAIL`, `NEXUS_SHOW_AUDIT`, `NEXUS_SHOW_EXPLORER`, and the existing admin/import variables. Never copy values from `.env`.

## Evidence

`npm run typecheck`, `npm run build`, anonymous smoke `5/5`, AUTH unit contracts and app integration suites passed locally. The latest app integration certification passed 42 tests twice against a separate disposable database. A final post-handoff unit rerun was intentionally not repeated after the emergency stop.

```text
LOCAL/MOCK PASSED
REAL SUPABASE NOT TESTED
NETLIFY NOT TESTED
```

`npm audit --omit=dev` was not run in this handoff. Expiry/logout/role/open-redirect contracts are covered in local tests; real Supabase cookie/session behavior still needs authorized preview testing.

## Pending

Create real identities and `app_metadata.nexus_role` claims, test real login/refresh/expiry/logout, configure redirect URLs, run Netlify preview and authenticated read-only smoke. None is authorized now.

```text
AUTH_IMPLEMENTED_PRODUCTION_CONFIGURATION_PENDING
```
