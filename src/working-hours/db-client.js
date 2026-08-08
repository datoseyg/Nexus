import "dotenv/config";
import pg from "pg";
import { assertSupabaseWriteAuthorized, isSupabaseCloudHost } from "../lib/db-safety.js";

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

// NEXUS V3 - un host reconocido como Supabase cloud ya NO es un bloqueo
// incondicional (como en la ETAPA 6.6B2 original). Ahora exige la misma
// política única que cualquier otro write V3 hacia Supabase (ver
// src/lib/db-safety.js::assertSupabaseWriteAuthorized): dual confirmation
// (CONFIRM_WRITE_TARGET + CONFIRM_PROTECTED_WRITE_TARGET, host:puerto/base
// EXACTOS) Y project ref V3 exacto (SUPABASE_PROJECT_REF_V3). Sin ambas
// cosas, sigue rechazado exactamente igual que antes -"promover a
// producción" ahora es ese flag/gate de despliegue explícito, en vez de una
// variable de entorno editada a mano. Un host NO-Supabase (local, etc.)
// sigue las reglas locales existentes, sin cambios.
function assertNotProductionHost(connectionString) {
  let hostname;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return; // formato no parseable -no es nuestra responsabilidad validar más allá acá
  }
  if (!isSupabaseCloudHost(hostname)) return;
  assertSupabaseWriteAuthorized(connectionString, { environment: process.env.NODE_ENV ?? "development" });
}

export function getConnectionString() {
  return requireEnv("WORKING_HOURS_DB_URL");
}

/**
 * Lee WORKING_HOURS_DB_URL (NUNCA SUPABASE_DB_URL_DIRECT) y rechaza
 * estructuralmente cualquier host reconocido como Supabase productivo.
 * @param {{ applicationName?: string }} [opts]
 * @returns {import("pg").Pool}
 */
export function createPool(opts = {}) {
  const connectionString = getConnectionString();
  assertNotProductionHost(connectionString);

  const pool = new Pool({
    connectionString,
    application_name: opts.applicationName ?? "working-hours-build",
    ssl: isLocalHost(connectionString) ? false : { rejectUnauthorized: false },
    max: 4
  });

  pool.on("error", error => {
    console.error("Error inesperado en el pool de Postgres (working-hours:build):", error);
  });

  return pool;
}

export { STATEMENT_TIMEOUT_MS, assertNotProductionHost };
