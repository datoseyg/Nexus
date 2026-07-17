import "dotenv/config";
import pg from "pg";

const { Pool, types } = pg;

types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);

const STATEMENT_TIMEOUT_MS = Number(process.env.WORKING_HOURS_STATEMENT_TIMEOUT_MS ?? 60000);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env -necesaria para conectar al Postgres del builder de horas fuera de jornada.`);
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

// Hosts reconocidos como productivos (Supabase) -si WORKING_HOURS_DB_URL
// apunta a alguno de estos, se rechaza estructuralmente. Promover este
// builder a producción es una decisión explícita de una subetapa futura
// (con su propio flag/gate de despliegue), nunca un efecto colateral de
// reutilizar accidentalmente una URL productiva.
const PRODUCTION_HOST_PATTERNS = [/\.supabase\.co$/i, /\.supabase\.com$/i, /pooler\.supabase\.com$/i];

function assertNotProductionHost(connectionString) {
  let hostname;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return; // formato no parseable -no es nuestra responsabilidad validar más allá acá
  }
  if (PRODUCTION_HOST_PATTERNS.some(re => re.test(hostname))) {
    throw new Error(
      `WORKING_HOURS_DB_URL apunta a un host reconocido como productivo (${hostname}). ` +
      `ETAPA 6.6B2 rechaza esto estructuralmente -este builder solo puede escribir contra ` +
      `Postgres 16 desechable durante esta subetapa. Promover a producción requiere un ` +
      `flag/gate de despliegue explícito de una subetapa futura, no editar esta variable.`
    );
  }
}

/**
 * Lee WORKING_HOURS_DB_URL (NUNCA SUPABASE_DB_URL_DIRECT) y rechaza
 * estructuralmente cualquier host reconocido como Supabase productivo.
 * @returns {import("pg").Pool}
 */
export function createPool() {
  const connectionString = requireEnv("WORKING_HOURS_DB_URL");
  assertNotProductionHost(connectionString);

  const pool = new Pool({
    connectionString,
    ssl: isLocalHost(connectionString) ? false : { rejectUnauthorized: false },
    max: 4
  });

  pool.on("error", error => {
    console.error("Error inesperado en el pool de Postgres (working-hours:build):", error);
  });

  return pool;
}

export { STATEMENT_TIMEOUT_MS, assertNotProductionHost };
