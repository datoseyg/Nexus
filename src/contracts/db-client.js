import "dotenv/config";
import pg from "pg";

const { Pool, types } = pg;

// pg devuelve DATE/TIMESTAMP/TIMESTAMPTZ como objetos Date por default -acá
// se overridea para que devuelvan el string crudo, igual que
// apps/nexus-bi-app/lib/db.ts. Sin esto, computeVersionAction() (que
// compara effectiveDate <= currentVersionRow.valid_from como strings)
// falla en silencio: comparar un string contra un Date con `<=` fuerza una
// conversión a Number, "2026-01-01" se vuelve NaN, y NaN <= cualquier cosa
// siempre es false -el chequeo de fecha retroactiva nunca se dispara.
// OIDs: 1082 = date, 1114 = timestamp, 1184 = timestamptz.
types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);

// Conexión DIRECTA (puerto 5432), rol postgres -igual que
// src/db/migrate-to-supabase.js/generate-postgres-ddl.js/validate-supabase.js.
// nexus_app nunca escribe acá (config.* no le otorga INSERT/UPDATE/DELETE en
// ninguna tabla real, solo SELECT sobre las vistas -ver sql/070_config.sql).
// max:1 -este importador nunca necesita más de una conexión concurrente
// (un solo PoolClient por corrida de --apply).
const STATEMENT_TIMEOUT_MS = Number(process.env.CONTRACTS_IMPORT_STATEMENT_TIMEOUT_MS ?? 30000);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en .env -necesaria para conectar a Supabase (conexión directa, puerto 5432).`);
  }
  return value;
}

// Supabase (producción) siempre exige SSL; un Postgres local/desechable de
// prueba (ej. contenedor Docker para test/contracts/db-writer.integration.test.js)
// típicamente no lo soporta. Auto-detectar por host es seguro: una
// connection string real de Supabase nunca apunta a localhost/127.0.0.1,
// así que esto nunca desactiva SSL contra producción por accidente.
function isLocalHost(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Expuesto por separado de createPool() para que ETAPA SAFETY-1
 * (assertWriteConfirmed en applyContracts()) pueda evaluar el destino
 * ANTES de abrir cualquier conexión real.
 * @returns {string}
 */
export function getConnectionString() {
  return requireEnv("SUPABASE_DB_URL_DIRECT");
}

/**
 * @param {{ applicationName?: string }} [opts]
 * @returns {import("pg").Pool}
 */
export function createPool(opts = {}) {
  const connectionString = getConnectionString();

  const pool = new Pool({
    connectionString,
    application_name: opts.applicationName ?? "contracts-import",
    ssl: isLocalHost(connectionString) ? false : { rejectUnauthorized: false },
    max: 1
  });

  pool.on("error", error => {
    console.error("Error inesperado en el pool de Postgres (contracts:import):", error);
  });

  return pool;
}

export { STATEMENT_TIMEOUT_MS };
