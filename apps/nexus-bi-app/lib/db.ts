import { Pool, types, type QueryResultRow } from "pg";

// Contrato público idéntico a lib/duckdb.ts (runQuery/serializeRow/
// serializeRows) a propósito -así el swap en las rutas existentes
// (Fase 4 de la migración) es mecánico: solo cambia el import, no la
// lógica de cada route.ts. Conecta contra el connection pooler de
// Supabase (Supavisor/PgBouncer, modo transaction, puerto 6543) -nunca
// la conexión directa, que se reserva para los scripts de migración/DDL
// que corren una vez desde la máquina local (src/db/migrate-to-supabase.js,
// src/db/generate-postgres-ddl.js).
export class DbConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConnectionError";
  }
}

export class DbNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbNotFoundError";
  }
}

// pg devuelve DATE/TIMESTAMP/TIMESTAMPTZ como objetos Date por default.
// Se overridea para que devuelvan el string crudo (mismo formato ISO-like
// que ya devolvía DuckDB) - varias rutas existentes hacen
// String(row.fecha) asumiendo ese formato, y así no cambia.
// OIDs: 1082 = date, 1114 = timestamp, 1184 = timestamptz.
types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);
// BIGINT (oid 20) y NUMERIC (oid 1700) ya vienen como string por default
// en pg - compatible con los Number(...) que ya usa el código existente,
// sin necesidad de override.

declare global {
  // eslint-disable-next-line no-var
  var __nexusPgPool: Pool | undefined;
}

export function resolveConnectionString(): string {
  const connectionString = process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new DbConnectionError(
      "Falta SUPABASE_DB_URL en el entorno. Configurala en .env.local con la connection string " +
      "del pooler de Supabase (puerto 6543, modo transaction) - ver docs/RUNBOOK_SUPABASE_NETLIFY.md."
    );
  }

  return connectionString;
}

export function extractHostname(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    throw new DbConnectionError("SUPABASE_DB_URL no es una connection string válida (no se pudo interpretar el host).");
  }
}

// ETAPA 6.6D-V - contrato explícito de SSL. Antes el Pool forzaba
// `ssl: { rejectUnauthorized: false }` sin importar el destino, lo que
// exigía habilitar SSL a mano en cualquier Postgres local/desechable solo
// para poder conectarse. Ahora "local" nunca se infiere en silencio del
// hostname -DATABASE_SSL_MODE=disable es el único camino, y solo se acepta
// contra localhost/127.0.0.1/::1 (nunca contra un host remoto, ni con
// NODE_ENV como atajo). Sin la variable, el default siempre es "require",
// incluso en localhost - así un desarrollador que no configuró nada nunca
// termina hablando en claro con una base sin querer.
export type DatabaseSslMode = "require" | "disable";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(normalizeHostname(hostname));
}

export function resolveSslMode(hostname: string, rawMode: string | undefined): DatabaseSslMode {
  if (rawMode === undefined) {
    return "require";
  }

  if (rawMode !== "require" && rawMode !== "disable") {
    throw new DbConnectionError(`DATABASE_SSL_MODE inválido: "${rawMode}". Valores permitidos: "require" | "disable".`);
  }

  if (rawMode === "disable" && !isLocalHostname(hostname)) {
    throw new DbConnectionError(
      `DATABASE_SSL_MODE=disable solo está permitido para hosts locales (localhost/127.0.0.1/::1). Host recibido: "${hostname}".`
    );
  }

  return rawMode;
}

export function buildSslConfig(mode: DatabaseSslMode): false | { rejectUnauthorized: boolean } {
  return mode === "disable" ? false : { rejectUnauthorized: false };
}

// Diagnóstico de conexión para consola de desarrollo (nunca para la
// respuesta HTTP -eso lo sigue decidiendo handleApiError). Nunca incluye
// usuario ni password: solo host/port/database/sslMode, ya suficiente para
// que un desarrollador identifique "a qué Postgres intenté conectarme".
export interface ConnectionDiagnostics {
  host: string;
  port: string;
  database: string;
  sslMode: DatabaseSslMode;
}

export function describeConnectionForLogging(connectionString: string, sslMode: DatabaseSslMode): ConnectionDiagnostics {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
    sslMode
  };
}

export function formatConnectionFailureLog(diagnostics: ConnectionDiagnostics, reason: string): string {
  return [
    "After-hours DB connection failed",
    `reason=${reason}`,
    `host=${diagnostics.host}`,
    `port=${diagnostics.port}`,
    `database=${diagnostics.database}`,
    `sslMode=${diagnostics.sslMode}`
  ].join("\n");
}

function errorReason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? error.message;
  }
  return String(error);
}

let currentDiagnostics: ConnectionDiagnostics | null = null;

function logConnectionFailure(reason: string): void {
  if (process.env.NODE_ENV === "production" || !currentDiagnostics) return;
  console.error(formatConnectionFailureLog(currentDiagnostics, reason));
}

function createPool(): Pool {
  let connectionString: string;
  let hostname: string;
  let sslMode: DatabaseSslMode;

  try {
    connectionString = resolveConnectionString();
    hostname = extractHostname(connectionString);
    sslMode = resolveSslMode(hostname, process.env.DATABASE_SSL_MODE);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`After-hours DB connection failed\nreason=${errorReason(error)}`);
    }
    throw error;
  }

  currentDiagnostics = describeConnectionForLogging(connectionString, sslMode);

  const pool = new Pool({
    connectionString,
    ssl: buildSslConfig(sslMode),
    max: 5
  });

  pool.on("error", error => {
    logConnectionFailure(errorReason(error));
    console.error("Error inesperado en el pool de Postgres:", error);
  });

  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__nexusPgPool) {
    globalThis.__nexusPgPool = createPool();
  }

  return globalThis.__nexusPgPool;
}

// BIGINT/NUMERIC de pg ya vienen como string (ver override de arriba) -
// no como bigint nativo de JS como en @duckdb/node-api, así que acá no
// hace falta convertir tipos raros para que JSON.stringify no explote.
// serializeRow/serializeRows se mantienen igual que en duckdb.ts por
// contrato público (para no romper imports existentes), aunque son
// prácticamente un passthrough con pg.
function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  return value;
}

export function serializeRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    result[key] = serializeValue(value);
  }

  return result;
}

export function serializeRows<T extends Record<string, unknown>>(rows: T[]): Record<string, unknown>[] {
  return rows.map(serializeRow);
}

export async function runQuery<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();

  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("ECONNREFUSED") || message.includes("timeout") || message.includes("terminated")) {
      logConnectionFailure(errorReason(error));
      throw new DbConnectionError(`No se pudo conectar a Supabase Postgres: ${message}`);
    }

    throw error;
  }
}
