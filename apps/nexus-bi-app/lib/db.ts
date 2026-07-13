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

function createPool(): Pool {
  const connectionString = process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new DbConnectionError(
      "Falta SUPABASE_DB_URL en el entorno. Configurala en .env.local con la connection string " +
      "del pooler de Supabase (puerto 6543, modo transaction) - ver docs/RUNBOOK_SUPABASE_NETLIFY.md."
    );
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5
  });

  pool.on("error", error => {
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
      throw new DbConnectionError(`No se pudo conectar a Supabase Postgres: ${message}`);
    }

    throw error;
  }
}
