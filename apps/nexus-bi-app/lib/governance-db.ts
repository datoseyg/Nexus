import { Pool, type QueryResultRow } from "pg";
import { DbConnectionError, extractHostname, resolveSslMode, resolveSslCa, buildSslConfig, assertNoConnectionStringSslOverrides } from "./db";

// Gate B (B13/B34): la autorización real de un comando de gobierno es el rol
// de conexión PostgreSQL y sus grants EXECUTE - nunca un argumento de la
// función ni un chequeo únicamente en la capa de aplicación. Por eso cada
// clase de operación de governance.* usa una conexión DEDICADA con su propio
// rol, nunca el pool genérico de lib/db.ts (que en producción conecta con
// permisos de lectura amplios sobre processed/marts/gold/quality, pero SIN
// ningún grant sobre governance.*/manual_review.* -confirmado por sql/089).
//
// Variables de entorno esperadas (una por rol, nunca la misma para dos
// roles): en desarrollo local, generadas por
// scripts/set-local-governance-role-passwords.mjs (nunca impresas); en
// Supabase, la contraseña real se fija en el dashboard (ver el placeholder
// "__SET_IN_SUPABASE_DASHBOARD__" en sql/089_governance_schema.sql) y esta
// variable se configura con esa credencial - nunca commiteada.
export type GovernanceDbRole =
  | "app_read"
  | "app_corrections"
  | "audit_restricted_read"
  | "rule_evaluator"
  | "command_attempt_logger"
  | "pipeline_requester"
  | "pipeline_worker";

const ENV_VAR_BY_ROLE: Record<GovernanceDbRole, string> = {
  app_read: "GOVERNANCE_APP_READ_DB_URL",
  app_corrections: "GOVERNANCE_APP_CORRECTIONS_DB_URL",
  audit_restricted_read: "GOVERNANCE_AUDIT_RESTRICTED_READ_DB_URL",
  rule_evaluator: "GOVERNANCE_RULE_EVALUATOR_DB_URL",
  command_attempt_logger: "GOVERNANCE_COMMAND_ATTEMPT_LOGGER_DB_URL",
  pipeline_requester: "GOVERNANCE_PIPELINE_REQUESTER_DB_URL",
  pipeline_worker: "GOVERNANCE_PIPELINE_WORKER_DB_URL"
};

declare global {
  // eslint-disable-next-line no-var
  var __nexusGovernancePgPools: Partial<Record<GovernanceDbRole, Pool>> | undefined;
}

function resolveGovernanceConnectionString(role: GovernanceDbRole): string {
  const envVar = ENV_VAR_BY_ROLE[role];
  const connectionString = process.env[envVar];

  if (!connectionString) {
    throw new DbConnectionError(
      `Falta ${envVar} en el entorno - necesaria para conectar como el rol PostgreSQL de gobierno "${role}" ` +
      "(nunca se reutiliza el pool genérico de lectura para esto, ver Gate B B13/B34). En desarrollo local, " +
      "correr `node scripts/set-local-governance-role-passwords.mjs` desde la raíz del repo; en Supabase, " +
      "fijar la contraseña del rol en el dashboard y configurar esta variable con esa credencial."
    );
  }

  return connectionString;
}

function createGovernancePool(role: GovernanceDbRole): Pool {
  const connectionString = resolveGovernanceConnectionString(role);
  // Misma lógica TLS compartida que lib/db.ts::createPool - nunca un
  // segundo algoritmo paralelo. Cada rol de gobierno sigue con su propia
  // connection string dedicada (Gate B B13/B34); DATABASE_SSL_MODE/
  // DATABASE_SSL_CA_B64 son las mismas variables de deployment para
  // cualquier conexión Postgres de esta app, gobierno o no.
  assertNoConnectionStringSslOverrides(connectionString);
  const hostname = extractHostname(connectionString);
  const sslMode = resolveSslMode(hostname, process.env.DATABASE_SSL_MODE);
  const sslCa = resolveSslCa(sslMode, process.env.DATABASE_SSL_CA_B64);

  const pool = new Pool({
    connectionString,
    ssl: buildSslConfig(sslMode, sslCa),
    max: 5
  });

  pool.on("error", error => {
    console.error(`Error inesperado en el pool de gobierno (rol=${role}):`, error);
  });

  return pool;
}

export function getGovernancePool(role: GovernanceDbRole): Pool {
  if (!globalThis.__nexusGovernancePgPools) {
    globalThis.__nexusGovernancePgPools = {};
  }

  const pools = globalThis.__nexusGovernancePgPools;
  if (!pools[role]) {
    pools[role] = createGovernancePool(role);
  }

  return pools[role]!;
}

export async function runGovernanceQuery<T extends QueryResultRow = Record<string, unknown>>(
  role: GovernanceDbRole,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getGovernancePool(role);

  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("ECONNREFUSED") || message.includes("timeout") || message.includes("terminated")) {
      throw new DbConnectionError(`No se pudo conectar a Postgres como rol de gobierno "${role}": ${message}`);
    }

    throw error;
  }
}
