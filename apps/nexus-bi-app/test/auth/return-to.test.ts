import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "../../lib/auth/return-to.ts";

test("acepta una ruta interna protegida con query", () => {
  assert.equal(safeReturnTo("/dashboard/fieldbeat?period=month"), "/dashboard/fieldbeat?period=month");
});

test("usa inicio cuando no hay destino", () => {
  assert.equal(safeReturnTo(null), "/");
  assert.equal(safeReturnTo(""), "/");
});

test("rechaza open redirects externos o ambiguos", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example/path",
    "\\\\evil.example\\path",
    "javascript:alert(1)",
    " dashboard/fieldbeat",
    "/login",
    "/login/",
    "/%6cogin",
    "/login?next=/dashboard/fieldbeat"
  ]) {
    assert.equal(safeReturnTo(value), "/", value);
  }
});
