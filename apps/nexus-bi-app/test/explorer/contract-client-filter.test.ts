import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyContractClientFilter } from "../../lib/contract-client-filter.ts";
import type { ExplorerFilterOption } from "../../lib/explorer-filters-config.ts";

const FACET_OPTIONS: ExplorerFilterOption[] = [
  { value: "radio oncologia del sur", label: "Radio Oncología del Sur" },
  { value: "clinica alemana de santiago", label: "Clínica Alemana de Santiago" }
];

// Bloque 2 NEXUS V3 - migración de un `client` heredado en la URL, sin
// matching difuso en el backend (ver lib/contract-client-filter.ts).

test("coincidencia exacta con la clave actual -> EXACT_MATCH, no toca nada", () => {
  const resolution = resolveLegacyContractClientFilter("radio oncologia del sur", FACET_OPTIONS);
  assert.deepEqual(resolution, { kind: "EXACT_MATCH", value: "radio oncologia del sur" });
});

test("valor heredado que folda a una clave única -> MIGRATED con esa clave", () => {
  const resolution = resolveLegacyContractClientFilter("Radio Oncología del Sur", FACET_OPTIONS);
  assert.deepEqual(resolution, { kind: "MIGRATED", value: "radio oncologia del sur" });
});

test("valor que no folda a ninguna opción actual -> UNRESOLVED, nunca elige una al azar", () => {
  const resolution = resolveLegacyContractClientFilter("Mantención Preventiva Anual Linac HCM", FACET_OPTIONS);
  assert.deepEqual(resolution, { kind: "UNRESOLVED" });
});

test("cadena vacía tras folding (nunca coincide con nada real) -> UNRESOLVED", () => {
  const resolution = resolveLegacyContractClientFilter("   ", FACET_OPTIONS);
  assert.deepEqual(resolution, { kind: "UNRESOLVED" });
});
