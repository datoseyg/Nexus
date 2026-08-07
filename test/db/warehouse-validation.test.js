// Unitaria, sin DB - validateWarehouseState() es una función pura (deep
// module: recibe inventarios + un adaptador de comparación, decide todo lo
// demás), ver src/db/warehouse-validation.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWarehouseState } from "../../src/db/warehouse-validation.js";

function neverCompare() {
  throw new Error("compareDuckdbSync no debería llamarse - ninguna tabla de este test es DUCKDB_SYNC");
}

// Regresión real (data/reports/supabase_validation_summary.json reportaba
// ambas en checks.unknown_objects hasta que se agregaron a
// src/db/ownership-manifest.js::POSTGRES_TRANSACTIONAL_ENTRIES).
test("manual_review.equipment_identification_overrides y fieldbeat_engineer_identity_map ya no se reportan como unknown_objects", async () => {
  const summary = await validateWarehouseState({
    duckdbTables: [],
    postgresTables: [
      { schema: "manual_review", table: "equipment_identification_overrides" },
      { schema: "manual_review", table: "fieldbeat_engineer_identity_map" }
    ],
    postgresViews: [],
    postgresColumnsByTable: {},
    compareDuckdbSync: neverCompare
  });

  assert.deepEqual(summary.checks.unknown_objects, []);

  const overrides = summary.objects.find(o => o.object === "manual_review.equipment_identification_overrides");
  assert.ok(overrides, "falta manual_review.equipment_identification_overrides en objects[]");
  assert.equal(overrides.ownership, "POSTGRES_TRANSACTIONAL");
  assert.equal(overrides.status, "POSTGRES_NATIVE_PRESENT");

  const identityMap = summary.objects.find(o => o.object === "manual_review.fieldbeat_engineer_identity_map");
  assert.ok(identityMap, "falta manual_review.fieldbeat_engineer_identity_map en objects[]");
  assert.equal(identityMap.ownership, "POSTGRES_TRANSACTIONAL");
  assert.equal(identityMap.status, "POSTGRES_NATIVE_PRESENT");
});

test("una tabla realmente sin clasificar SÍ sigue reportándose unknown (el fix no rompe la detección real)", async () => {
  const summary = await validateWarehouseState({
    duckdbTables: [],
    postgresTables: [{ schema: "manual_review", table: "una_tabla_sin_clasificar_de_verdad" }],
    postgresViews: [],
    postgresColumnsByTable: {},
    compareDuckdbSync: neverCompare
  });

  assert.deepEqual(summary.checks.unknown_objects, [
    { object: "manual_review.una_tabla_sin_clasificar_de_verdad", kind: "table", source: "postgres" }
  ]);
  assert.equal(summary.validation_status, "FAILED");
});
