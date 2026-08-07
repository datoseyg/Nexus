import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContractClientNameKey } from "../../apps/nexus-bi-app/lib/contract-client-name-key.js";
import { createClientNameNormalizer } from "../../src/contracts/normalize-client.js";
import { foldName } from "../../src/contracts/fieldbeat-matcher.js";

// Bloque 2 NEXUS V3 - identidad normalizada de cliente contractual.
// client_name_key se persiste en config.contract_equipment_versions y se
// usa como identidad del facet/filtro de Cliente en Contratos - debe ser
// estable ante mayúsculas, tildes, espacios y Unicode, y debe ser EL MISMO
// algoritmo en los 3 puntos que lo consumen (helper único, no 3
// implementaciones paralelas).
test("buildContractClientNameKey: mayúsculas/tildes/espacios convergen a la misma clave", () => {
  const variants = ["ABC", "Ábc", "abc", " abc ", "A B C".replace(/\s+/g, ""), "ABC  "];
  const keys = new Set(variants.map(buildContractClientNameKey));
  // "A B C" sin colapsar espacios es un caso distinto a propósito (ver test
  // de abajo) - se excluye de este grupo por eso, se prueba aparte.
  assert.equal(new Set(["ABC", "Ábc", "abc", " abc ", "ABC  "].map(buildContractClientNameKey)).size, 1);
  void keys;
});

test("buildContractClientNameKey: Radio Oncología del Sur - variantes reales convergen", () => {
  const keys = new Set(
    ["Radio Oncología del Sur", "RADIO ONCOLOGÍA DEL SUR", "radio oncologia del sur", "  Radio Oncología del Sur  "].map(buildContractClientNameKey)
  );
  assert.equal(keys.size, 1);
  assert.equal(buildContractClientNameKey("Radio Oncología del Sur"), "radio oncologia del sur");
});

test("buildContractClientNameKey: colapsa espacios múltiples pero no inventa uno donde no hay", () => {
  assert.equal(buildContractClientNameKey("Radio   Oncología    del Sur"), buildContractClientNameKey("Radio Oncología del Sur"));
  // Sin espacio entre tokens nunca converge con la versión espaciada - el
  // folding no reconcilia tokenización, solo mayúsculas/tildes/espacios.
  assert.notEqual(buildContractClientNameKey("RadioOncologia"), buildContractClientNameKey("Radio Oncologia"));
});

test("buildContractClientNameKey: null/undefined/solo-espacios producen cadena vacía, nunca lanzan", () => {
  assert.equal(buildContractClientNameKey(null), "");
  assert.equal(buildContractClientNameKey(undefined), "");
  assert.equal(buildContractClientNameKey("   "), "");
});

test("buildContractClientNameKey: alias semántico (ROS) NO converge con el nombre completo - el folding no resuelve semántica", () => {
  assert.notEqual(buildContractClientNameKey("ROS"), buildContractClientNameKey("Radio Oncología del Sur"));
});

// Un solo algoritmo, 3 consumidores (createClientNameNormalizer().normalize()
// -> .clientNameKey, fieldbeat-matcher.js#foldName, y este archivo
// directamente) - todos deben producir EXACTAMENTE el mismo valor para la
// misma entrada, nunca 3 implementaciones que puedan divergir.
test("los 3 consumidores del algoritmo de folding producen la misma clave", () => {
  const raw = "  Clínica Alemana DE Santiago  ";
  const direct = buildContractClientNameKey(raw);
  const viaNormalizer = createClientNameNormalizer().normalize(raw).clientNameKey;
  const viaFoldName = foldName(raw);
  assert.equal(direct, viaNormalizer);
  assert.equal(direct, viaFoldName);
});
