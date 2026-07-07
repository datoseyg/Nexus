import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "../db/warehouse-config.js";
import { readCsv } from "../lib/csv.js";
import { sanitizeD1Value } from "./sanitize-d1-export.js";

// Exporta el warehouse DuckDB local (+ CSV de curación, que no viven en
// DuckDB) a seeds SQL de Cloudflare D1 (SQLite) - Fase 2 Cloud read-only,
// ver docs/CLOUDFLARE_D1_MIGRATION.md. Solo LEE data/warehouse/eyg_nexus.duckdb
// (READ_ONLY) y los CSV de business-rules/data/curation - nunca los
// modifica. Cada columna pasa por sanitize-d1-export.js (redacción de
// email/teléfono/token, truncado de texto largo, RUT enmascarado) antes de
// convertirse en un literal SQL.

const SEEDS_DIR = path.join("cloud", "d1", "seeds");
// D1 rechaza sentencias SQL demasiado largas (SQLITE_TOOBIG) - verificado
// contra un D1 local emulado (`wrangler d1 execute --local`): 200 filas por
// INSERT rompía la tabla más ancha (marts_fieldbeat_working_hours_analysis,
// ~28 columnas incluyendo varias de texto libre). 50 quedó probado OK.
const BATCH_SIZE = 50;
const SUMMARY_FILE = path.join("data", "reports", "cloud_d1_export_summary.json");

// Orden fijo = mismo orden que cloud/d1/schema.sql. `source` puede ser una
// tabla DuckDB (`schema`+`table`) o un CSV de curación fuera del warehouse
// (`csv`) - ver business-rules/README.md sobre por qué curation_* no vive
// en DuckDB. `optional: true` => si la fuente no existe (o solo hay
// *.example.csv), se genera un seed vacío en vez de fallar el export
// completo - mismo criterio que TABLES en src/db/warehouse-config.js.
const TABLES = [
  { d1Table: "gold_operational_dashboard", source: { schema: "gold", table: "operational_dashboard" } },
  { d1Table: "gold_fieldbeat_report_analysis", source: { schema: "gold", table: "fieldbeat_report_analysis" } },
  { d1Table: "gold_fieldbeat_data_quality", source: { schema: "gold", table: "fieldbeat_data_quality" } },
  { d1Table: "gold_client_report_volume_by_period", source: { schema: "gold", table: "client_report_volume_by_period" } },
  { d1Table: "gold_client_parts_consumption", source: { schema: "gold", table: "client_parts_consumption" } },
  { d1Table: "gold_equipment_parts_consumption", source: { schema: "gold", table: "equipment_parts_consumption" } },
  { d1Table: "gold_after_hours_work_analysis", source: { schema: "gold", table: "after_hours_work_analysis" } },
  { d1Table: "gold_after_hours_by_client", source: { schema: "gold", table: "after_hours_by_client" } },
  { d1Table: "gold_after_hours_by_period", source: { schema: "gold", table: "after_hours_by_period" } },
  { d1Table: "gold_scope_metadata", source: { schema: "gold", table: "scope_metadata" } },
  { d1Table: "marts_used_parts_dolibarr_match", source: { schema: "marts", table: "used_parts_dolibarr_match" } },
  {
    d1Table: "marts_fieldbeat_report_dolibarr_operational_view",
    source: { schema: "marts", table: "fieldbeat_report_dolibarr_operational_view" }
  },
  { d1Table: "marts_fieldbeat_working_hours_analysis", source: { schema: "marts", table: "fieldbeat_working_hours_analysis" } },
  {
    d1Table: "curation_placeholder_rules",
    source: { csv: "data/curation/placeholder_rules.csv" },
    optional: true,
    optionalReason: "Solo existe data/curation/placeholder_rules.example.csv (plantilla) - el negocio no completó el archivo real todavía."
  },
  {
    d1Table: "curation_part_identity_aliases",
    source: { csv: "data/curation/part_identity_aliases.csv" },
    optional: true,
    optionalReason: "Solo existe data/curation/part_identity_aliases.example.csv (plantilla) - el negocio no completó el archivo real todavía."
  },
  {
    d1Table: "rules_client_contracts",
    source: { schema: "rules", table: "client_contracts" },
    optional: true,
    optionalReason: "Solo existe business-rules/entities/client_contracts.example.csv - la tabla rules.client_contracts no se crea en DuckDB hasta que exista el archivo real."
  },
  {
    d1Table: "rules_part_manufacturer_life",
    source: { schema: "rules", table: "part_manufacturer_life" },
    optional: true,
    optionalReason: "Solo existe business-rules/entities/part_manufacturer_life.example.csv - la tabla rules.part_manufacturer_life no se crea en DuckDB hasta que exista el archivo real."
  }
];

function sqlTypeFromDuckDbType(columnType) {
  const t = columnType.toUpperCase();
  if (t.includes("BOOL")) return "INTEGER";
  if (t.includes("INT")) return "INTEGER";
  if (t.includes("DOUBLE") || t.includes("DECIMAL") || t.includes("FLOAT") || t.includes("REAL")) return "REAL";
  return "TEXT";
}

async function tableExists(connection, schema, table) {
  const reader = await connection.runAndReadAll(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}'`
  );
  return Number(reader.getRowObjects()[0].n) > 0;
}

async function describeColumns(connection, schema, table) {
  const reader = await connection.runAndReadAll(`DESCRIBE ${schema}.${table}`);
  return reader.getRowObjects().map(row => ({
    name: row.column_name,
    sqlType: sqlTypeFromDuckDbType(String(row.column_type))
  }));
}

function buildInsertStatements(d1Table, columns, rows) {
  const columnNames = columns.map(c => c.name);
  const statements = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const valueTuples = batch.map(row => {
      const literals = columns.map(col => sanitizeD1Value(row[col.name], { columnName: col.name, sqlType: col.sqlType }));
      return `(${literals.join(", ")})`;
    });
    statements.push(`INSERT INTO ${d1Table} (${columnNames.join(", ")}) VALUES\n${valueTuples.join(",\n")};`);
  }

  return statements;
}

async function writeSeedFile(index, d1Table, columns, rows, note) {
  await fs.mkdir(SEEDS_DIR, { recursive: true });
  const fileName = `${String(index).padStart(3, "0")}_${d1Table}.sql`;
  const filePath = path.join(SEEDS_DIR, fileName);

  const header = [
    `-- Seed generado por src/cloud/export-d1-seed.js - NO EDITAR A MANO.`,
    `-- Tabla: ${d1Table}`,
    `-- Filas: ${rows.length}`,
    note ? `-- Nota: ${note}` : null
  ].filter(Boolean);

  // `wrangler d1 execute --file` exige al menos una sentencia SQL
  // ejecutable - un archivo con solo comentarios tira "SQL code did not
  // contain a statement" (verificado contra un D1 local emulado). Se usa un
  // SELECT no-op en vez de dejar el archivo sin sentencias, para que "un
  // seed por tabla" siga siendo válido como archivo de wrangler incluso
  // cuando la tabla queda vacía.
  const body =
    rows.length > 0 ? buildInsertStatements(d1Table, columns, rows) : ["SELECT 1; -- (sin filas para exportar, ver nota arriba)"];

  await fs.writeFile(filePath, `${header.join("\n")}\n\n${body.join("\n\n")}\n`, "utf8");
  console.log(`Seed generado: ${filePath} (${rows.length} filas)`);
  return { fileName, rows: rows.length };
}

export async function exportD1Seed() {
  console.log("=== Exportando seeds Cloudflare D1 ===");
  console.log(`Origen warehouse (solo lectura): ${DB_PATH}`);

  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();

  const results = [];

  try {
    for (let i = 0; i < TABLES.length; i += 1) {
      const entry = TABLES[i];
      const index = i + 1;

      if (entry.source.csv) {
        const csvRows = await readCsv(entry.source.csv);
        if (csvRows.length === 0) {
          const written = await writeSeedFile(index, entry.d1Table, [], [], entry.optionalReason);
          results.push({ d1Table: entry.d1Table, source: entry.source.csv, ...written, skipped: true, skippedReason: entry.optionalReason });
          continue;
        }
        const columns = Object.keys(csvRows[0]).map(name => ({ name, sqlType: "TEXT" }));
        const written = await writeSeedFile(index, entry.d1Table, columns, csvRows, null);
        results.push({ d1Table: entry.d1Table, source: entry.source.csv, ...written, skipped: false });
        continue;
      }

      const { schema, table } = entry.source;
      const exists = await tableExists(connection, schema, table);
      if (!exists) {
        if (!entry.optional) throw new Error(`Tabla requerida ${schema}.${table} no existe en el warehouse - corré "npm run db:build" primero.`);
        const written = await writeSeedFile(index, entry.d1Table, [], [], entry.optionalReason);
        results.push({ d1Table: entry.d1Table, source: `${schema}.${table}`, ...written, skipped: true, skippedReason: entry.optionalReason });
        continue;
      }

      const columns = await describeColumns(connection, schema, table);
      const reader = await connection.runAndReadAll(`SELECT * FROM ${schema}.${table}`);
      const rows = reader.getRowObjects();
      const written = await writeSeedFile(index, entry.d1Table, columns, rows, null);
      results.push({ d1Table: entry.d1Table, source: `${schema}.${table}`, ...written, skipped: false });
    }
  } finally {
    connection.closeSync();
  }

  const summary = {
    generated_at: new Date().toISOString(),
    seeds_dir: SEEDS_DIR.split(path.sep).join("/"),
    batch_size: BATCH_SIZE,
    tables: results
  };

  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  const totalRows = results.reduce((sum, r) => sum + r.rows, 0);
  console.log(`=== ${results.length} seed(s) generados, ${totalRows} fila(s) en total - resumen en ${SUMMARY_FILE} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  exportD1Seed().catch(error => {
    console.error("ERROR EXPORTANDO SEED D1:");
    console.error(error);
    process.exit(1);
  });
}
