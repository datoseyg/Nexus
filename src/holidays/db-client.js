import "dotenv/config";
import pg from "pg";

const { Pool, types } = pg;

// Mismo override de tipos que src/contracts/db-client.js -pg devuelve
// DATE/TIMESTAMP/TIMESTAMPTZ como Date por default; acá se necesita el
// string crudo para comparaciones de fecha estables (coverage_start/
// coverage_end_exclusive, local_date). OIDs: 1082=date, 1114=timestamp, 1184=timestamptz.
types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);

const STATEMENT_TIMEOUT_MS = Number(process.env.HOLIDAYS_IMPORT_STATEMENT_TIMEOUT_MS ?? 30000);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en .env -necesaria para conectar al Postgres de feriados.`);
  }
  return value;
}

function isLocalHost(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * ETAPA 6.6B1: lee deliberadamente HOLIDAYS_DB_URL, NUNCA
 * SUPABASE_DB_URL_DIRECT -a diferencia de src/contracts/db-client.js (que sí
 * apunta a producción), este importador debe ser estructuralmente incapaz de
 * escribir contra Supabase productivo mientras esa variable no exista o no
 * se le asigne deliberadamente. Promover este importador a producción es una
 * decisión explícita de una subetapa posterior, no un efecto colateral de
 * reutilizar el nombre de variable ya usado por contracts/migrate-to-supabase.
 * @returns {import("pg").Pool}
 */
export function createPool() {
  const connectionString = requireEnv("HOLIDAYS_DB_URL");

  const pool = new Pool({
    connectionString,
    ssl: isLocalHost(connectionString) ? false : { rejectUnauthorized: false },
    max: 1
  });

  pool.on("error", error => {
    console.error("Error inesperado en el pool de Postgres (holidays:import):", error);
  });

  return pool;
}

export { STATEMENT_TIMEOUT_MS };
