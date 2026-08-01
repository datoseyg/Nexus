// Tests puros (sin DB) para la ampliación de PLACEHOLDER_LITERALS
// (src/resolvers/part-identity-resolver.js). El resolver SOLO decide
// PLACEHOLDER_VALUE vs match real - la distinción NO_PART_USED vive en SQL
// (quality.classify_part_declaration, sql/098-099) y se prueba por separado
// en apps/nexus-bi-app/test/audit/no-part-used-classification.integration.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePartIdentity, PLACEHOLDER_LITERALS } from "../../src/resolvers/part-identity-resolver.js";

const EMPTY_IDENTITY_MAP = [];

// Literales nuevos (no estaban en la lista original de 24) que esta tarea
// agrega porque significan "no se utilizó repuesto/consumo/material" -deben
// seguir devolviendo PLACEHOLDER_VALUE desde el resolver (la reclasificación
// a NO_PART_USED ocurre después, en SQL, nunca acá).
const NEW_NO_PART_USED_MEANING_LITERALS = [
  "no", "no hay", "ninguno", "ninguna", "ningún", "nada",
  "no existe", "no existen", "no aplicable", "no corresponde", "no procede",
  "no requerido", "no requerida", "no requiere", "no se requiere",
  "sin uso de repuesto", "sin utilizar repuestos", "no se utilizó repuesto",
  "repuesto no utilizado", "no consume", "sin consumo", "sin material",
  "sin insumo", "none", "not applicable", "no part", "without parts"
];

for (const literal of NEW_NO_PART_USED_MEANING_LITERALS) {
  test(`resolvePartIdentity('${literal}') => PLACEHOLDER_VALUE (nuevo en PLACEHOLDER_LITERALS)`, () => {
    const result = resolvePartIdentity(literal, EMPTY_IDENTITY_MAP);
    assert.equal(result.match_status, "PLACEHOLDER_VALUE", `"${literal}" debería ser PLACEHOLDER_VALUE, obtuve "${result.match_status}"`);
    assert.equal(result.match_method, "PLACEHOLDER_REJECTED");
  });
}

// Literales que describen un identificador/dato faltante (no una ausencia de
// repuesto) - el resolver los sigue tratando igual (PLACEHOLDER_VALUE), la
// SQL de sql/099 es la que decide no reclasificarlos a NO_PART_USED.
const MISSING_IDENTIFIER_LITERALS = ["sin número", "sin serie", "s/n", "sn", "sin código", "sin identificador"];

for (const literal of MISSING_IDENTIFIER_LITERALS) {
  test(`resolvePartIdentity('${literal}') => PLACEHOLDER_VALUE (identificador faltante, sin cambio de comportamiento)`, () => {
    const result = resolvePartIdentity(literal, EMPTY_IDENTITY_MAP);
    assert.equal(result.match_status, "PLACEHOLDER_VALUE");
  });
}

test("resolvePartIdentity - 'No' antes de esta ampliación caía en NO_MATCH (reproduce la causa raíz original)", () => {
  // No hay forma de "desampliar" PLACEHOLDER_LITERALS para reproducir el
  // bug viejo sin duplicar la lista - esta prueba documenta el contrato
  // vigente (PLACEHOLDER_VALUE) en vez de la regresión histórica.
  const result = resolvePartIdentity("No", EMPTY_IDENTITY_MAP);
  assert.notEqual(result.match_status, "NO_MATCH", "\"No\" nunca debería volver a caer en NO_MATCH - esa fue la causa raíz original (root cause A)");
});

test("resolvePartIdentity - variantes de normalización de 'no hay' (guion/guion bajo/barra/mayúsculas) producen el mismo normalized_part_identifier", () => {
  const variants = ["NO HAY", "No hay.", "no-hay", "no_hay", "no/hay"];
  const results = variants.map(v => resolvePartIdentity(v, EMPTY_IDENTITY_MAP));
  const first = results[0].normalized_part_identifier;
  for (const r of results) {
    assert.equal(r.normalized_part_identifier, first);
    assert.equal(r.match_status, "PLACEHOLDER_VALUE");
  }
});

test("resolvePartIdentity - el alias manual sigue pisando cualquier literal placeholder nuevo (precedencia intacta)", () => {
  const aliasRows = [{ alias_type: "RAW", alias_value: "No hay", dolibarr_product_id: "999", dolibarr_ref: "REF-999" }];
  const result = resolvePartIdentity("No hay", EMPTY_IDENTITY_MAP, aliasRows);
  assert.equal(result.match_status, "MATCHED");
  assert.equal(result.match_method, "MANUAL_ALIAS_EXACT");
  assert.equal(result.dolibarr_product_id, "999");
});

test("PLACEHOLDER_LITERALS sigue exportado y contiene los literales nuevos clave (contrato para la prueba de divergencia SQL)", () => {
  assert.ok(Array.isArray(PLACEHOLDER_LITERALS));
  for (const literal of ["no", "no hay", "ninguno", "ninguna", "nada"]) {
    assert.ok(PLACEHOLDER_LITERALS.includes(literal), `PLACEHOLDER_LITERALS debería incluir "${literal}"`);
  }
});
