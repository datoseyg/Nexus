import "dotenv/config";
import pg from "pg";
import { describeConnectionTarget, buildWriteConfirmationToken } from "../lib/db-safety.js";

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
// apunta a alguno de estos, se rechaza por defecto. Promover este builder a
// producción exige el mismo opt-in dual-token que ya usan
// migrate-to-supabase.js/contracts/holidays (ver src/lib/db-safety.js) -
// nunca un efecto colateral de reutilizar accidentalmente una URL
// productiva: sin AMBOS CONFIRM_WRITE_TARGET y CONFIRM_PROTECTED_WRITE_TARGET
// exactos host:puerto/base de ESTE destino, este guard sigue abortando
// igual que antes de DEPLOY NEXUS 2026-07.
const PRODUCTION_HOST_PATTERNS = [/\.supabase\.co$/i, /\.supabase\.com$/i, /pooler\.supabase\.com$/i];

function isDualConfirmedProtectedTarget(connectionString) {
  let target;
  try {
    target = describeConnectionTarget(connectionString);
  } catch {
    return false;
  }
  const expectedToken = buildWriteConfirmationToken(target);
  return process.env.CONFIRM_WRITE_TARGET === expectedToken && process.env.CONFIRM_PROTECTED_WRITE_TARGET === expectedToken;
}

function assertNotProductionHost(connectionString) {
  let hostname;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return; // formato no parseable -no es nuestra responsabilidad validar más allá acá
  }
  if (PRODUCTION_HOST_PATTERNS.some(re => re.test(hostname))) {
    if (isDualConfirmedProtectedTarget(connectionString)) return;
    throw new Error(
      `WORKING_HOURS_DB_URL apunta a un host reconocido como productivo (${hostname}). ` +
      `Este builder solo escribe contra ese destino con AMBOS CONFIRM_WRITE_TARGET y ` +
      `CONFIRM_PROTECTED_WRITE_TARGET exactos (host:puerto/base) -nunca editando esta ` +
      `variable ni con una bandera genérica.`
    );
  }
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
