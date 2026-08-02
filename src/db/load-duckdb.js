import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_DIR, DB_PATH, SCHEMAS, TABLES } from "./warehouse-config.js";

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// CREATE OR REPLACE TABLE hace que el loader sea reconstruible desde cero:
// cada corrida reemplaza el contenido completo de cada tabla con lo que hay
// hoy en el CSV correspondiente, sin acumular filas viejas ni requerir un
// DROP manual previo.
//
// dbPath/schemas/tables son parámetros opcionales (con los valores reales
// del módulo como default) SOLO para poder probar esta función contra un
// .duckdb y unos CSV temporales y aislados (ver test/db/load-duckdb.test.js)
// - ningún caller real (este archivo como CLI, ni
// scripts/pipeline/run-data-refresh.mjs) los pasa nunca; ambos siguen
// operando sobre data/warehouse/eyg_nexus.duckdb tal cual.
export async function loadDuckDb({ dbPath = DB_PATH, schemas = SCHEMAS, tables = TABLES } = {}) {
  console.log("=== Cargando DuckDB Warehouse desde CSV (reconstrucción completa) ===");

  await fs.mkdir(DB_DIR, { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  for (const schema of schemas) {
    await connection.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }

  const results = [];

  for (const { schema, table, csv } of tables) {
    const fullTableName = `${schema}.${table}`;

    if (!(await fileExists(csv))) {
      console.warn(`SALTADO ${fullTableName}: no existe ${csv} (¿corriste el pipeline CSV completo?)`);
      results.push({ table: fullTableName, csv, status: "SKIPPED_MISSING_CSV" });
      continue;
    }

    try {
      await connection.run(
        `CREATE OR REPLACE TABLE ${fullTableName} AS SELECT * FROM read_csv_auto('${csv}', header=true)`
      );

      const reader = await connection.runAndReadAll(`SELECT COUNT(*) AS n FROM ${fullTableName}`);
      const rowCount = Number(reader.getRowObjects()[0].n);

      console.log(`Cargado ${fullTableName}: ${rowCount} filas (${csv})`);
      results.push({ table: fullTableName, csv, status: "LOADED", row_count: rowCount });
    } catch (error) {
      console.error(`ERROR cargando ${fullTableName}: ${error.message}`);
      results.push({ table: fullTableName, csv, status: "ERROR", error: error.message });
    }
  }

  connection.closeSync();
  // instance.closeSync() (distinto de connection.closeSync(), ver
  // node_modules/@duckdb/node-api/lib/DuckDBInstance.d.ts) - sin esto, el
  // handle nativo del archivo queda abierto aunque la conexión se cierre.
  // Antes era invisible porque cada script era su propio proceso (el SO
  // libera el handle al salir); ahora que el orquestador
  // (scripts/pipeline/run-data-refresh.mjs) abre este MISMO archivo varias
  // veces seguidas dentro de un solo proceso (LOAD_DUCKDB -> SYNC_POSTGRES ->
  // ... -> VALIDATE), un handle sin cerrar hace fallar la siguiente apertura
  // con "the process cannot access the file" (reproducido en
  // test/db/load-duckdb.test.js).
  instance.closeSync();

  const loaded = results.filter(r => r.status === "LOADED").length;
  const skipped = results.filter(r => r.status === "SKIPPED_MISSING_CSV").length;
  const failed = results.filter(r => r.status === "ERROR").length;

  console.log(`=== Carga finalizada: ${loaded} cargadas, ${skipped} saltadas, ${failed} con error ===`);

  if (failed > 0) {
    throw new Error(`${failed} tabla(s) fallaron al cargar. Ver detalle arriba.`);
  }

  return results;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  loadDuckDb().catch(error => {
    console.error("ERROR CARGANDO DUCKDB:");
    console.error(error);
    process.exit(1);
  });
}
