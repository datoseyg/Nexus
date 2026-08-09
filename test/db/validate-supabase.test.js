import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as ownershipManifest from "../../src/db/ownership-manifest.js";
import * as validationModule from "../../src/db/validate-supabase.js";
import * as ddlModule from "../../src/db/generate-postgres-ddl.js";

function requireValidationInterface() {
  assert.equal(typeof ownershipManifest.listOwnershipEntries, "function", "falta listOwnershipEntries");
  assert.equal(typeof validationModule.validateWarehouseState, "function", "falta validateWarehouseState");
  return validationModule.validateWarehouseState;
}

function healthyInventory() {
  const entries = ownershipManifest.listOwnershipEntries();
  const duckdbTables = entries
    .filter(entry => entry.kind === "table" && [ownershipManifest.OWNERSHIP.DUCKDB_SYNC, ownershipManifest.OWNERSHIP.EXTERNAL].includes(entry.ownership))
    .map(entry => ({ schema: entry.schema, table: entry.name }));
  const postgresTables = entries
    .filter(entry => entry.kind === "table" && entry.ownership !== ownershipManifest.OWNERSHIP.EXTERNAL)
    .map(entry => ({ schema: entry.schema, table: entry.name }));
  const postgresViews = entries
    .filter(entry => entry.kind === "view")
    .map(entry => ({ schema: entry.schema, view: entry.name }));
  const postgresColumnsByTable = Object.fromEntries(
    entries
      .filter(entry => entry.ownership === ownershipManifest.OWNERSHIP.POSTGRES_BUILDER)
      .map(entry => [`${entry.schema}.${entry.name}`, [...entry.requiredColumns]])
  );
  return { duckdbTables, postgresTables, postgresViews, postgresColumnsByTable };
}

function matchingComparison(key) {
  return {
    object: key,
    status: "MATCH",
    duckdb_row_count: 3,
    postgres_row_count: 3,
    missing_columns: [],
    extra_columns: [],
    type_mismatches: []
  };
}

test("solo DUCKDB_SYNC participa en igualdad DuckDB/PostgreSQL", async () => {
  const validateWarehouseState = requireValidationInterface();
  const compared = [];
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => {
      compared.push(`${entry.schema}.${entry.name}`);
      return matchingComparison(`${entry.schema}.${entry.name}`);
    }
  });
  const expected = ownershipManifest.listOwnershipEntries({ ownership: ownershipManifest.OWNERSHIP.DUCKDB_SYNC }).map(entry => `${entry.schema}.${entry.name}`).sort();
  assert.deepEqual(compared.sort(), expected);
  assert.equal(summary.validation_status, "PASSED");
});

test("EXTERNAL no produce falso faltante en PostgreSQL", async () => {
  const validateWarehouseState = requireValidationInterface();
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => matchingComparison(`${entry.schema}.${entry.name}`)
  });
  assert.deepEqual(summary.checks.duckdb_sync_missing_in_postgres, []);
  assert.ok(summary.objects.some(result => result.ownership === ownershipManifest.OWNERSHIP.EXTERNAL && result.status === "NOT_SYNCHRONIZED"));
});

test("POSTGRES_BUILDER valida existencia/columnas y nunca se compara con DuckDB", async () => {
  const validateWarehouseState = requireValidationInterface();
  const compared = [];
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => {
      compared.push(`${entry.schema}.${entry.name}`);
      return matchingComparison(`${entry.schema}.${entry.name}`);
    }
  });
  assert.equal(summary.checks.postgres_builder_missing.length, 0);
  assert.equal(summary.checks.postgres_builder_contract_mismatches.length, 0);
  assert.ok(summary.objects.some(result => result.ownership === ownershipManifest.OWNERSHIP.POSTGRES_BUILDER && result.status === "POSTGRES_NATIVE_MATCH"));
  assert.ok(compared.every(key => !key.includes("fieldbeat_working_hours_analysis_v2")));
});

test("POSTGRES_TRANSACTIONAL exige existencia pero nunca compara conteos", async () => {
  const validateWarehouseState = requireValidationInterface();
  const compared = [];
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => {
      compared.push(`${entry.schema}.${entry.name}`);
      return matchingComparison(`${entry.schema}.${entry.name}`);
    }
  });
  assert.equal(summary.checks.postgres_transactional_missing.length, 0);
  assert.ok(summary.objects.some(result => result.ownership === ownershipManifest.OWNERSHIP.POSTGRES_TRANSACTIONAL && result.status === "POSTGRES_NATIVE_PRESENT"));
  assert.ok(compared.every(key => !key.startsWith("config.") && !key.startsWith("audit.") && !key.startsWith("manual_review.") && !key.startsWith("stock.")));
});

test("VIEW_NOT_APPLICABLE no se reporta como tabla faltante ni extra", async () => {
  const validateWarehouseState = requireValidationInterface();
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => matchingComparison(`${entry.schema}.${entry.name}`)
  });
  assert.ok(summary.objects.some(result => result.ownership === ownershipManifest.OWNERSHIP.VIEW_NOT_APPLICABLE && result.status === "NOT_APPLICABLE"));
  assert.deepEqual(summary.checks.unknown_objects, []);
});

test("objeto sin clasificación genera diagnóstico explícito y FAILED", async () => {
  const validateWarehouseState = requireValidationInterface();
  const inventory = healthyInventory();
  inventory.postgresTables.push({ schema: "marts", table: "drift_sin_clasificar" });
  const summary = await validateWarehouseState({
    ...inventory,
    compareDuckdbSync: async entry => matchingComparison(`${entry.schema}.${entry.name}`)
  });
  assert.equal(summary.validation_status, "FAILED");
  assert.deepEqual(summary.checks.unknown_objects, [{ object: "marts.drift_sin_clasificar", kind: "table", source: "postgres" }]);
});

test("validador ejecutable es read-only y no contiene el UPDATE oculto", async () => {
  const source = await fs.readFile("src/db/validate-supabase.js", "utf8");
  assert.match(source, /access_mode:\s*["']READ_ONLY["']/);
  assert.doesNotMatch(source, /assertWriteConfirmed|postgresExecute|UPDATE\s+audit\.warehouse_sync_state|access_mode:\s*["']READ_WRITE["']/i);
});

test("fallo parcial conserva la causa y produce FAILED", async () => {
  const validateWarehouseState = requireValidationInterface();
  let first = true;
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => {
      if (first) {
        first = false;
        throw new Error(`fallo controlado en ${entry.schema}.${entry.name}`);
      }
      return matchingComparison(`${entry.schema}.${entry.name}`);
    }
  });
  assert.equal(summary.validation_status, "FAILED");
  assert.equal(summary.checks.comparison_errors.length, 1);
  assert.match(summary.checks.comparison_errors[0].cause, /fallo controlado/);
});

test("resultado íntegramente sano produce PASSED", async () => {
  const validateWarehouseState = requireValidationInterface();
  const summary = await validateWarehouseState({
    ...healthyInventory(),
    compareDuckdbSync: async entry => matchingComparison(`${entry.schema}.${entry.name}`)
  });
  assert.equal(summary.validation_status, "PASSED");
  assert.equal(summary.checks.duckdb_sync_all_match, true);
});

test("procedencia enlaza el resumen con destino sanitizado y run_id compatible", () => {
  assert.equal(typeof validationModule.buildValidationProvenance, "function");
  const provenance = validationModule.buildValidationProvenance(
    "postgresql://user:secret@localhost:55480/nexus_bi_dev_local_test",
    { run_id: "run-local", target: "localhost:55480/nexus_bi_dev_local_test" }
  );
  assert.deepEqual(provenance, {
    target: "localhost:55480/nexus_bi_dev_local_test",
    sync_run_id: "run-local"
  });
  assert.doesNotMatch(JSON.stringify(provenance), /secret/);
});

test("procedencia no adopta run_id de otro destino", () => {
  const provenance = validationModule.buildValidationProvenance(
    "postgresql://user:secret@localhost:55480/nexus_bi_dev_local_test",
    { run_id: "run-ajeno", target: "localhost:55480/otra_base_disposable" }
  );
  assert.equal(provenance.sync_run_id, null);
});

test("TIMESTAMP de DuckDB coincide con timestamp without time zone de PostgreSQL", () => {
  assert.equal(typeof ddlModule.postgresTypeMatchesDuckdb, "function", "falta el contrato compartido de tipos");
  assert.equal(ddlModule.postgresTypeMatchesDuckdb("TIMESTAMP", "timestamp without time zone"), true);
  assert.equal(ddlModule.postgresTypeMatchesDuckdb("TIMESTAMP WITH TIME ZONE", "timestamp with time zone"), true);
  assert.equal(ddlModule.postgresTypeMatchesDuckdb("BIGINT", "text"), false);
});
