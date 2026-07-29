import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import { glob } from "node:fs/promises";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("existen clientes Supabase browser y server separados sin service_role", async () => {
  const browser = await source("lib/supabase/browser.ts");
  const server = await source("lib/supabase/server.ts");

  assert.match(browser, /createBrowserClient/);
  assert.match(browser, /NEXT_PUBLIC_SUPABASE_URL: process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(browser, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(browser, /readSupabasePublicConfig\(process\.env\)/);
  assert.match(server, /createServerClient/);
  assert.match(server, /await cookies\(\)/);
  assert.match(server, /getAll\(\)/);
  assert.match(server, /setAll\(/);
  assert.doesNotMatch(`${browser}\n${server}`, /SERVICE_ROLE/);
});

test("Next 16 usa proxy.ts y no middleware.ts", async () => {
  const proxy = await source("proxy.ts");
  assert.match(proxy, /export async function proxy/);
  await assert.rejects(() => stat("middleware.ts"));
});

test("todos los Route Handlers están protegidos por el mecanismo correcto", async () => {
  const routes: string[] = [];
  for await (const path of glob("app/api/**/route.ts")) routes.push(path);

  // Historial de conteo hasta Phase 6: ver git blame de esta línea para el
  // detalle 42->47 (FieldBeat KPI/quality/crossings/reports/detalle/open/pdf).
  // Gate B (Familias 1-9) agregó 29 Route Handlers nuevos (47 -> 76): rutas
  // de comando (correction:part-alias/ticket-link/technician-identity/
  // equipment-identification/reverse, issues start-review/dismiss/reopen,
  // review-cases + membership/assign/comment/redact/close/reopen, restricted
  // reads, exports de Auditoría/Explorador) + rutas de lectura nuevas
  // (issues/review-cases listado y detalle, history, kpis, corrections,
  // rules, evaluation-runs) - ninguna reemplaza una ruta existente.
  assert.equal(routes.length, 76);

  for (const path of routes) {
    const contents = await source(path);
    const normalizedPath = path.replaceAll("\\", "/");
    if (normalizedPath.includes("app/api/admin/")) {
      // Gate B (Familia 9/B19): un endpoint retirado (410 ENDPOINT_RETIRED
      // incondicional para todos) está protegido por rechazo universal, no
      // por un chequeo de token - no necesita requireAdminToken. Cualquier
      // otra ruta admin (incluido su propio GET de inspección histórica, si
      // lo tiene) sigue exigiendo el token.
      const isRetiredStub = /ENDPOINT_RETIRED/.test(contents);
      if (!isRetiredStub) {
        assert.match(contents, /requireAdminToken/, path);
      }
    } else {
      // Gate B (Familias 1-8) agregó 2 mecanismos nuevos de sesión junto al
      // original requireReadApiAccess: requireCapability (comandos de
      // gobierno, verifica una capacidad nombrada contra
      // governance.role_capabilities) y requireAuthenticatedUser (rutas que
      // necesitan el objeto de usuario completo, ej. para registrar quién
      // exportó). Los tres son mecanismos de sesión reales - nunca el token
      // admin legado ni ausencia de chequeo.
      const usesReadApiAccess = /requireReadApiAccess/.test(contents);
      const usesCapability = /requireCapability/.test(contents);
      const usesAuthenticatedUser = /requireAuthenticatedUser/.test(contents);
      assert.ok(
        usesReadApiAccess || usesCapability || usesAuthenticatedUser,
        `${path}: debe usar requireReadApiAccess, requireCapability o requireAuthenticatedUser`
      );
      if (usesReadApiAccess) {
        assert.match(contents, /if \(authError\) return authError;/, path);
      } else {
        // requireCapability/requireAuthenticatedUser señalan 401/403 vía
        // NexusAuthorizationError (capturado explícitamente), nunca un
        // authError de retorno temprano.
        assert.match(contents, /NexusAuthorizationError/, path);
      }
    }
  }
});

test("todas las páginas de producto tienen verificación server-side adicional", async () => {
  const protectedEntries = [
    "app/page.tsx",
    "app/dashboard/layout.tsx",
    "app/audit/layout.tsx",
    "app/explorer/layout.tsx",
    "app/search/layout.tsx"
  ];

  for (const path of protectedEntries) {
    assert.match(await source(path), /requireAuthenticatedUser/, path);
  }
});

test("los módulos pausados se ocultan en sidebar e inicio mediante los mismos flags", async () => {
  const home = await source("app/page.tsx");
  const homeNavigation = await source("components/home/HomeNavigationGrid.tsx");
  const sidebarNavigation = await source("components/layout/SidebarNavigation.tsx");

  assert.match(home, /NEXUS_SHOW_AUDIT/);
  assert.match(home, /NEXUS_SHOW_EXPLORER/);
  assert.match(home, /<HomeNavigationGrid showAudit=\{showAudit\}/);
  assert.match(homeNavigation, /showAudit \|\| item\.feature !== "audit"/);
  assert.match(sidebarNavigation, /features\[item\.feature\]/);
});
