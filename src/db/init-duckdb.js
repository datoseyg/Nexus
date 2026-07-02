import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_DIR, DB_PATH, SCHEMAS } from "./warehouse-config.js";

export async function initDuckDb() {
  console.log("=== Inicializando DuckDB Warehouse ===");

  await fs.mkdir(DB_DIR, { recursive: true });

  const instance = await DuckDBInstance.create(DB_PATH);
  const connection = await instance.connect();

  for (const schema of SCHEMAS) {
    await connection.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    console.log(`Schema listo: ${schema}`);
  }

  connection.closeSync();

  console.log(`Base de datos: ${DB_PATH}`);
  console.log("=== DuckDB Warehouse inicializado ===");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  initDuckDb().catch(error => {
    console.error("ERROR INICIALIZANDO DUCKDB:");
    console.error(error);
    process.exit(1);
  });
}
