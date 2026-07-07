import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { readCsv } from "../lib/csv.js";
import { DB_PATH, TABLES } from "./warehouse-config.js";

const SUMMARY_FILE = "data/reports/duckdb_validation_summary.json";

export async function validateDuckDb() {
  console.log("=== Validando DuckDB Warehouse (conteos CSV vs SQL) ===");

  const instance = await DuckDBInstance.create(DB_PATH);
  const connection = await instance.connect();

  const results = [];

  for (const { schema, table, csv, optional } of TABLES) {
    const fullTableName = `${schema}.${table}`;
    const csvRows = await readCsv(csv);
    const csvRowCount = csvRows.length;

    let sqlRowCount = null;
    let status;

    try {
      const reader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${fullTableName}`);
      sqlRowCount = Number(reader.getRowObjects()[0].n);
      status = sqlRowCount === csvRowCount ? "MATCH" : "MISMATCH";
    } catch {
      // Tabla opcional (ej. rules.* de business-rules/) sin CSV real
      // todavía - no es un error, es el estado esperado hasta que el
      // negocio complete el archivo (ver business-rules/README.md).
      status = optional ? "SKIPPED_OPTIONAL" : "TABLE_NOT_FOUND";
    }

    console.log(`${fullTableName}: CSV=${csvRowCount} SQL=${sqlRowCount ?? "n/a"} -> ${status}`);
    results.push({ table: fullTableName, csv, csv_row_count: csvRowCount, sql_row_count: sqlRowCount, status, optional: !!optional });
  }

  connection.closeSync();

  const allMatch = results.every(r => r.status === "MATCH" || r.status === "SKIPPED_OPTIONAL");

  const summary = {
    generated_at: new Date().toISOString(),
    all_match: allMatch,
    tables: results
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);

  if (!allMatch) {
    throw new Error("Validación falló: hay tablas con conteos CSV vs SQL que no calzan. Ver detalle arriba.");
  }

  console.log("=== Validación OK: todos los conteos CSV vs SQL calzan ===");

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  validateDuckDb().catch(error => {
    console.error("ERROR VALIDANDO DUCKDB:");
    console.error(error);
    process.exit(1);
  });
}
