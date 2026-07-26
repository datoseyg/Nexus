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

  // Phase 2 FieldBeat (KPI overview + quality) agrega 2 Route Handlers
  // nuevos (42 -> 44); Phase 3 agrega crossings (44 -> 45) - los 3
  // protegidos por requireReadApiAccess (verificado abajo, mismo mecanismo
  // que el resto). Phase 3 también elimina 2 rutas sin consumidores tras
  // el rediseño de 4 pestañas (§11): el GOLD fijo /api/dashboard/fieldbeat
  // y /api/dashboard/fieldbeat/activity (45 -> 43). Phase 4 reemplaza la
  // bandeja transitoria: elimina /api/dashboard/fieldbeat/detail y agrega
  // /api/dashboard/fieldbeat/reports + /api/dashboard/fieldbeat/reports/export
  // (43 -> 44). Phase 5 agrega el detalle maestro
  // /api/dashboard/fieldbeat/reports/[id] (44 -> 45). Phase 6 agrega
  // /api/dashboard/fieldbeat/reports/[id]/open (45 -> 46) y
  // /api/dashboard/fieldbeat/reports/[id]/pdf (46 -> 47).
  assert.equal(routes.length, 47);

  for (const path of routes) {
    const contents = await source(path);
    const normalizedPath = path.replaceAll("\\", "/");
    if (normalizedPath.includes("app/api/admin/")) {
      assert.match(contents, /requireAdminToken/, path);
    } else {
      assert.match(contents, /requireReadApiAccess/, path);
      assert.match(contents, /if \(authError\) return authError;/, path);
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
