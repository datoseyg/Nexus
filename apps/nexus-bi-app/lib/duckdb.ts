import path from "node:path";
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";

// apps/nexus-bi-app/ vive dos niveles bajo la raíz del proyecto - el
// warehouse ya existe, generado por `npm run db:build` en la raíz. Esta
// app NUNCA lo crea ni lo escribe, solo lo abre en modo READ_ONLY.
const DB_PATH = path.join(process.cwd(), "..", "..", "data", "warehouse", "eyg_nexus.duckdb");

export class DuckDbLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuckDbLockedError";
  }
}

export class DuckDbNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuckDbNotFoundError";
  }
}

// Cache en globalThis (no en una variable de módulo simple) para
// sobrevivir el hot-reload de `next dev` sin abrir una conexión nueva
// en cada guardado de archivo.
declare global {
  // eslint-disable-next-line no-var
  var __nexusDuckDbConnection: Promise<DuckDBConnection> | undefined;
}

async function createConnection(): Promise<DuckDBConnection> {
  try {
    const instance = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
    return await instance.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("being used by another process")) {
      throw new DuckDbLockedError(
        `No se pudo abrir la base de datos (${DB_PATH}): el archivo está siendo usado por ` +
        "otro proceso - probablemente DBeaver u otra herramienta con una conexión abierta. " +
        "Cerrá esa conexión e intentá de nuevo."
      );
    }

    if (message.includes("No such file") || message.includes("Cannot open file") || message.includes("does not exist")) {
      throw new DuckDbNotFoundError(
        `No existe ${DB_PATH}. Corré "npm run db:build" desde la raíz del proyecto antes de ` +
        "levantar esta app."
      );
    }

    throw error;
  }
}

export async function getConnection(): Promise<DuckDBConnection> {
  if (!globalThis.__nexusDuckDbConnection) {
    globalThis.__nexusDuckDbConnection = createConnection().catch(error => {
      // No cachear una promesa rechazada: si la DB estaba bloqueada en el
      // primer intento pero se liberó después, el próximo request debe
      // poder reintentar en vez de quedar con el error pegado.
      globalThis.__nexusDuckDbConnection = undefined;
      throw error;
    });
  }

  return globalThis.__nexusDuckDbConnection;
}

// DuckDB devuelve BIGINT como `bigint` nativo de JS (no JSON-serializable
// - JSON.stringify tira TypeError). Ninguno de los conteos de este
// warehouse se acerca a Number.MAX_SAFE_INTEGER, así que convertir a
// Number() acá es seguro.
//
// Además, tipos como TIMESTAMP/TIMESTAMPTZ vuelven como instancias de
// clase propias de @duckdb/node-api (ej. DuckDBTimestampTZValue), NO
// como bigint de primer nivel - pero esas instancias guardan su valor
// interno en un campo propio que SÍ es bigint (ej. `.micros`), y
// JSON.stringify falla igual al recorrer ese objeto anidado. Se detectan
// por no ser un object literal plano (constructor !== Object) y se
// convierten con su propio toString() (ya da un string legible, ej.
// "2021-01-29 07:30:00-04").
function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object" && value.constructor !== Object) return String(value);
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

export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  params?: DuckDBValue[]
): Promise<T[]> {
  const connection = await getConnection();
  const reader = params && params.length > 0
    ? await connection.runAndReadAll(sql, params)
    : await connection.runAndReadAll(sql);

  return reader.getRowObjects() as T[];
}
