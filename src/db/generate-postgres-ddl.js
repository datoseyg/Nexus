import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "./warehouse-config.js";

// La fuente de verdad para el DDL de Postgres es el .duckdb VIVO, no
// warehouse-config.js ni SQL_WAREHOUSE.md - ambos quedaron desactualizados
// respecto a lo que realmente hay cargado (40 tablas, no 26 - ver
// docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md). Este script introspecciona
// information_schema.columns directo y emite CREATE TABLE IF NOT EXISTS
// para processed/marts/gold, agrupado por schema en sql/010-030.
const SCHEMAS = ["processed", "marts", "gold"];

const OUTPUT_FILES = {
  processed: "sql/010_processed.sql",
  marts: "sql/020_marts.sql",
  gold: "sql/030_gold.sql"
};

// Solo 6 tipos DuckDB aparecen hoy en estos 3 schemas (verificado por
// query directa) - se mapean explícitamente. Cualquier tipo no listado
// cae a TEXT (fallback seguro) en vez de fallar el generador. Exportado
// para que src/db/validate-supabase.js compare tipos con el mismo mapeo,
// en vez de duplicar la tabla.
export const TYPE_MAP = {
  BIGINT: "BIGINT",
  BOOLEAN: "BOOLEAN",
  DOUBLE: "DOUBLE PRECISION",
  TIMESTAMP: "TIMESTAMP",
  "TIMESTAMP WITH TIME ZONE": "TIMESTAMPTZ",
  VARCHAR: "TEXT"
};

export function mapType(duckdbType) {
  return TYPE_MAP[duckdbType] ?? "TEXT";
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function generatePostgresDdl() {
  console.log("=== Generando DDL de Postgres desde el DuckDB vivo (solo lectura) ===");

  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();

  const tablesReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN ('processed', 'marts', 'gold')
     ORDER BY table_schema, table_name`
  );
  const tables = tablesReader.getRowObjects();

  const columnsReader = await connection.runAndReadAll(
    `SELECT table_schema, table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema IN ('processed', 'marts', 'gold')
     ORDER BY table_schema, table_name, ordinal_position`
  );
  const columns = columnsReader.getRowObjects();

  connection.closeSync();

  const columnsByTable = new Map();
  for (const col of columns) {
    const key = `${col.table_schema}.${col.table_name}`;
    if (!columnsByTable.has(key)) columnsByTable.set(key, []);
    columnsByTable.get(key).push(col);
  }

  const sqlBySchema = { processed: [], marts: [], gold: [] };
  const summary = [];

  for (const { table_schema: schema, table_name: table } of tables) {
    const key = `${schema}.${table}`;
    const cols = columnsByTable.get(key) ?? [];

    if (cols.length === 0) {
      console.warn(`SALTADA ${key}: sin columnas (¿tabla vacía de definición?)`);
      continue;
    }

    const columnLines = cols
      .map(c => `  ${quoteIdentifier(c.column_name)} ${mapType(c.data_type)}`)
      .join(",\n");

    const ddl = `CREATE TABLE IF NOT EXISTS ${schema}.${quoteIdentifier(table)} (\n${columnLines}\n);`;
    sqlBySchema[schema].push(ddl);
    summary.push({ schema, table, columns: cols.length });
  }

  for (const schema of SCHEMAS) {
    const header =
      `-- AUTOGENERADO por src/db/generate-postgres-ddl.js — NO EDITAR A MANO.\n` +
      `-- Fuente: information_schema.columns de data/warehouse/eyg_nexus.duckdb (introspección en vivo).\n` +
      `-- Para regenerar: npm run db:pg:ddl\n` +
      `-- Ver docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md para las tablas sin script generador propio.\n\n`;

    const body = sqlBySchema[schema].join("\n\n") + "\n";
    await fs.writeFile(OUTPUT_FILES[schema], header + body, "utf8");
    console.log(`Escrito ${OUTPUT_FILES[schema]}: ${sqlBySchema[schema].length} tablas`);
  }

  console.log(`=== DDL generado: ${summary.length} tablas en total (processed/marts/gold) ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  generatePostgresDdl().catch(error => {
    console.error("ERROR GENERANDO DDL DE POSTGRES:");
    console.error(error);
    process.exit(1);
  });
}
