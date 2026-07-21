import assert from "node:assert/strict";
import test from "node:test";
import { decideRouteAccess } from "../../lib/auth/route-policy.ts";

test("login es pública sin sesión", () => {
  assert.deepEqual(decideRouteAccess("/login", false), { action: "next" });
});

test("inicio y dashboards redirigen a login sin sesión", () => {
  assert.deepEqual(decideRouteAccess("/", false), {
    action: "redirect",
    location: "/login?next=%2F"
  });
  assert.deepEqual(decideRouteAccess("/dashboard/fieldbeat", false), {
    action: "redirect",
    location: "/login?next=%2Fdashboard%2Ffieldbeat"
  });
});

test("una sesión válida accede a páginas protegidas", () => {
  assert.deepEqual(decideRouteAccess("/dashboard/fieldbeat", true), { action: "next" });
});

test("una sesión válida en login redirige al inicio", () => {
  assert.deepEqual(decideRouteAccess("/login", true), {
    action: "redirect",
    location: "/"
  });
});

test("las APIs nunca se redirigen a HTML", () => {
  assert.deepEqual(decideRouteAccess("/api/dashboard/fieldbeat", false), { action: "next" });
  assert.deepEqual(decideRouteAccess("/api/search", false), { action: "next" });
  assert.deepEqual(decideRouteAccess("/api/admin/stock/movements", false), { action: "next" });
});

test("recursos estáticos permanecen públicos", () => {
  assert.deepEqual(decideRouteAccess("/_next/static/app.js", false), { action: "next" });
  assert.deepEqual(decideRouteAccess("/favicon.ico", false), { action: "next" });
});
