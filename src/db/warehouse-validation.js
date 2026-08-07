import {
  classifyOwnership,
  listOwnershipEntries,
  OWNERSHIP
} from "./ownership-manifest.js";

function tableKey(item) {
  return `${item.schema}.${item.table}`;
}

function viewKey(item) {
  return `${item.schema}.${item.view}`;
}

function columnsFor(columnsByTable, key) {
  const columns = columnsByTable[key] ?? [];
  return new Set(columns);
}

function unknownDiagnostic(item, kind, source) {
  return {
    object: kind === "view" ? viewKey(item) : tableKey(item),
    kind,
    source
  };
}

/**
 * Deep module for ownership-aware validation. Callers provide inventories
 * and one comparison adapter; the module decides what must be compared,
 * what is Postgres-native, what is not applicable, and whether the run passes.
 */
export async function validateWarehouseState({
  duckdbTables,
  postgresTables,
  postgresViews,
  postgresColumnsByTable = {},
  compareDuckdbSync
}) {
  const entries = listOwnershipEntries();
  const duckKeys = new Set(duckdbTables.map(tableKey));
  const postgresKeys = new Set(postgresTables.map(tableKey));
  const postgresViewKeys = new Set(postgresViews.map(viewKey));
  const unknownObjects = [];

  for (const table of duckdbTables) {
    if (!classifyOwnership(table.schema, table.table).known) {
      unknownObjects.push(unknownDiagnostic(table, "table", "duckdb"));
    }
  }
  for (const table of postgresTables) {
    if (!classifyOwnership(table.schema, table.table).known) {
      unknownObjects.push(unknownDiagnostic(table, "table", "postgres"));
    }
  }
  for (const view of postgresViews) {
    if (!classifyOwnership(view.schema, view.view, "view").known) {
      unknownObjects.push(unknownDiagnostic(view, "view", "postgres"));
    }
  }

  unknownObjects.sort((a, b) => `${a.source}:${a.kind}:${a.object}`.localeCompare(`${b.source}:${b.kind}:${b.object}`));

  const checks = {
    unknown_objects: unknownObjects,
    duckdb_sync_missing_in_duckdb: [],
    duckdb_sync_missing_in_postgres: [],
    postgres_builder_missing: [],
    postgres_builder_contract_mismatches: [],
    postgres_transactional_missing: [],
    comparison_errors: [],
    comparison_mismatches: [],
    duckdb_sync_all_match: true
  };
  const objects = [];

  for (const manifestEntry of entries) {
    const key = manifestEntry.key;

    switch (manifestEntry.ownership) {
      case OWNERSHIP.DUCKDB_SYNC: {
        const missingDuckdb = !duckKeys.has(key);
        const missingPostgres = !postgresKeys.has(key);
        if (missingDuckdb) checks.duckdb_sync_missing_in_duckdb.push(key);
        if (missingPostgres) checks.duckdb_sync_missing_in_postgres.push(key);

        if (missingDuckdb || missingPostgres) {
          objects.push({ object: key, ownership: manifestEntry.ownership, status: missingDuckdb ? "MISSING_IN_DUCKDB" : "MISSING_IN_POSTGRES" });
          break;
        }

        try {
          const comparison = await compareDuckdbSync(manifestEntry);
          objects.push({ ...comparison, object: key, ownership: manifestEntry.ownership });
          if (comparison.status !== "MATCH") {
            checks.comparison_mismatches.push({ object: key, status: comparison.status });
          }
        } catch (error) {
          const cause = error instanceof Error ? error.message : String(error);
          checks.comparison_errors.push({ object: key, cause });
          objects.push({ object: key, ownership: manifestEntry.ownership, status: "ERROR", cause });
        }
        break;
      }

      case OWNERSHIP.EXTERNAL:
        objects.push({ object: key, ownership: manifestEntry.ownership, status: "NOT_SYNCHRONIZED" });
        break;

      case OWNERSHIP.POSTGRES_BUILDER: {
        if (!postgresKeys.has(key)) {
          checks.postgres_builder_missing.push(key);
          objects.push({ object: key, ownership: manifestEntry.ownership, status: "MISSING_IN_POSTGRES" });
          break;
        }

        const actualColumns = columnsFor(postgresColumnsByTable, key);
        const missingColumns = manifestEntry.requiredColumns.filter(column => !actualColumns.has(column));
        if (missingColumns.length > 0) {
          checks.postgres_builder_contract_mismatches.push({ object: key, missing_columns: missingColumns });
          objects.push({ object: key, ownership: manifestEntry.ownership, status: "POSTGRES_NATIVE_MISMATCH", missing_columns: missingColumns });
        } else {
          objects.push({ object: key, ownership: manifestEntry.ownership, status: "POSTGRES_NATIVE_MATCH" });
        }
        break;
      }

      case OWNERSHIP.POSTGRES_TRANSACTIONAL:
        if (!postgresKeys.has(key)) {
          checks.postgres_transactional_missing.push(key);
          objects.push({ object: key, ownership: manifestEntry.ownership, status: "MISSING_IN_POSTGRES" });
        } else {
          objects.push({ object: key, ownership: manifestEntry.ownership, status: "POSTGRES_NATIVE_PRESENT" });
        }
        break;

      case OWNERSHIP.VIEW_NOT_APPLICABLE:
        objects.push({
          object: key,
          ownership: manifestEntry.ownership,
          status: "NOT_APPLICABLE",
          present_in_postgres: postgresViewKeys.has(key)
        });
        break;

      default:
        throw new Error(`Ownership no soportado para ${key}: ${manifestEntry.ownership}`);
    }
  }

  checks.duckdb_sync_all_match =
    checks.duckdb_sync_missing_in_duckdb.length === 0 &&
    checks.duckdb_sync_missing_in_postgres.length === 0 &&
    checks.comparison_errors.length === 0 &&
    checks.comparison_mismatches.length === 0;

  const allPass =
    checks.unknown_objects.length === 0 &&
    checks.duckdb_sync_all_match &&
    checks.postgres_builder_missing.length === 0 &&
    checks.postgres_builder_contract_mismatches.length === 0 &&
    checks.postgres_transactional_missing.length === 0;

  return {
    generated_at: new Date().toISOString(),
    validation_status: allPass ? "PASSED" : "FAILED",
    checks,
    objects,
    tables: objects.filter(object => object.ownership !== OWNERSHIP.VIEW_NOT_APPLICABLE)
  };
}
