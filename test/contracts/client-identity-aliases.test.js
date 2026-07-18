// ETAPA 6.5.2B1 - Tests del módulo puro de gobernanza de alias de cliente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientIdentityAliasIndex, resolveCanonicalClientName } from "../../src/contracts/client-identity-aliases.js";

const ENTRIES = [
  {
    canonical_name: "Sanatorio Alemán",
    aliases: ["ONCORAD", "CLÍNICA SANATORIO ALEMÁN (ONCORAD)", "Clínica Sanatorio Alemán (ONCORAD)"],
    scope: "CLIENT_IDENTITY",
    source_type: "USER_CONFIRMED",
    approved: true
  },
  {
    canonical_name: "Instituto Radio Oncológico",
    aliases: ["INRAD"],
    scope: "CLIENT_IDENTITY",
    source_type: "USER_CONFIRMED",
    approved: true
  },
  {
    canonical_name: "Cliente No Aprobado Todavía",
    aliases: ["ALIAS_SIN_APROBAR"],
    scope: "CLIENT_IDENTITY",
    source_type: "USER_CONFIRMED",
    approved: false
  }
];

test("1. ONCORAD resuelve a Sanatorio Alemán", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(resolveCanonicalClientName("ONCORAD", index), "Sanatorio Alemán");
});

test("2. CLÍNICA SANATORIO ALEMÁN (ONCORAD) resuelve a Sanatorio Alemán", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(resolveCanonicalClientName("CLÍNICA SANATORIO ALEMÁN (ONCORAD)", index), "Sanatorio Alemán");
});

test("3. variantes de mayúsculas/minúsculas/espacios/tildes no rompen el alias aprobado", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(resolveCanonicalClientName("oncorad", index), "Sanatorio Alemán");
  assert.equal(resolveCanonicalClientName("  ONCORAD  ", index), "Sanatorio Alemán");
  assert.equal(resolveCanonicalClientName("clinica sanatorio aleman (oncorad)", index), "Sanatorio Alemán");
  assert.equal(resolveCanonicalClientName("Clínica   Sanatorio   Alemán   (ONCORAD)", index), "Sanatorio Alemán");
});

test("4. INRAD resuelve a Instituto Radio Oncológico", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(resolveCanonicalClientName("INRAD", index), "Instituto Radio Oncológico");
});

test("5. un alias no aprobado (approved=false) no se acepta -el nombre crudo pasa sin cambios", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(index.has("alias_sin_aprobar"), false);
  assert.equal(resolveCanonicalClientName("ALIAS_SIN_APROBAR", index), "ALIAS_SIN_APROBAR");
});

test("un nombre sin ningún alias gobernado pasa sin cambios (identidad)", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(resolveCanonicalClientName("Cliente Cualquiera Sin Alias", index), "Cliente Cualquiera Sin Alias");
});

test("el nombre canónico resuelve a sí mismo (idempotencia)", () => {
  const index = buildClientIdentityAliasIndex(ENTRIES);
  assert.equal(resolveCanonicalClientName("Sanatorio Alemán", index), "Sanatorio Alemán");
});
