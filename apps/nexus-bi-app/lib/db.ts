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

// ETAPA 6.6D-V (endurecida - release productivo NEXUS V3) - contrato
// explícito de SSL. Antes el Pool forzaba `ssl: { rejectUnauthorized: false
// }` para CUALQUIER destino no-disable: cifra la conexión, pero nunca
// verifica que el certificado del servidor pertenezca a quien dice ser
// (vulnerable a un MITM que presente cualquier certificado autofirmado).
// Ahora el único modo remoto es "verify-full" -verificación estricta de
// certificado Y hostname, igual que exige sslmode=verify-full de libpq- y
// "disable" sigue existiendo SOLO para Postgres local (nunca se infiere del
// hostname sin que DATABASE_SSL_MODE lo pida explícitamente, ni con
// NODE_ENV como atajo). El viejo valor "require" ya NO es válido -cifraba
// sin verificar identidad, exactamente el hueco que se cierra acá- y falla
// cerrado como cualquier otro valor desconocido, nunca cae en silencio a un
// modo más débil.
export type DatabaseSslMode = "verify-full" | "disable";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(normalizeHostname(hostname));
}

export function resolveSslMode(hostname: string, rawMode: string | undefined): DatabaseSslMode {
  if (rawMode === undefined) {
    return "verify-full";
  }

  if (rawMode !== "verify-full" && rawMode !== "disable") {
    throw new DbConnectionError(`DATABASE_SSL_MODE inválido: "${rawMode}". Valores permitidos: "verify-full" | "disable".`);
  }

  if (rawMode === "disable" && !isLocalHostname(hostname)) {
    throw new DbConnectionError(
      `DATABASE_SSL_MODE=disable solo está permitido para hosts locales (localhost/127.0.0.1/::1). Host recibido: "${hostname}".`
    );
  }

  return rawMode;
}

// La CA raíz (ej. la de Supabase) viaja como variable de entorno SERVER-ONLY
// en base64 -nunca una ruta de archivo local (Netlify no tiene un
// filesystem persistente para depositar un .pem, y una ruta hardcodeada
// rompería portabilidad entre deployments) y nunca se escribe a disco acá.
// "disable" (solo local) no necesita CA -Postgres local no presenta un
// certificado que verificar. Los mensajes de error de esta función NUNCA
// incluyen el valor crudo ni el PEM decodificado, solo el diagnóstico de
// forma (falta / no es base64+PEM válido).
const PEM_CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;

export function resolveSslCa(mode: DatabaseSslMode, rawBase64: string | undefined): string | undefined {
  if (mode === "disable") {
    return undefined;
  }

  if (!rawBase64) {
    throw new DbConnectionError(
      "Falta DATABASE_SSL_CA_B64 en el entorno - obligatoria bajo DATABASE_SSL_MODE=verify-full: el PEM de la CA raíz " +
      "(ej. la de Supabase) codificado en base64, nunca una ruta de archivo local."
    );
  }

  const decoded = Buffer.from(rawBase64, "base64").toString("utf8");

  if (!PEM_CERTIFICATE_PATTERN.test(decoded)) {
    throw new DbConnectionError(
      "DATABASE_SSL_CA_B64 no decodifica a un certificado PEM válido " +
      "(se esperaba un bloque -----BEGIN CERTIFICATE----- / -----END CERTIFICATE-----)."
    );
  }

  return decoded;
}

// Nunca existe un tercer valor de retorno con rejectUnauthorized:false -las
// únicas dos formas posibles son "sin TLS" (disable, solo local) o
// "verificación estricta con CA explícita" (verify-full). ca faltante bajo
// verify-full es un error de programación del caller (resolveSslCa ya lo
// exige antes de llegar acá) - se rechaza en vez de construir un Pool con
// una config a medias.
export function buildSslConfig(mode: DatabaseSslMode, ca: string | undefined): false | { rejectUnauthorized: true; ca: string } {
  if (mode === "disable") {
    return false;
  }

  if (!ca) {
    throw new DbConnectionError("buildSslConfig: falta la CA para DATABASE_SSL_MODE=verify-full (llamar resolveSslCa antes de construir el Pool).");
  }

  return { rejectUnauthorized: true, ca };
}

// node-postgres (vía pg-connection-string) reemplaza el objeto `ssl`
// explícito del Pool si la connection string trae sus propios parámetros
// SSL en la query string - un SUPABASE_DB_URL/GOVERNANCE_*_DB_URL con
// `?sslmode=require` (o similar) podría entonces pisar silenciosamente la
// verificación estricta de arriba. Se rechaza ANTES de crear cualquier Pool
// -nunca se eliminan/modifican esos parámetros automáticamente, exige
// corregir la connection string a mano- y el mensaje de error nombra
// ÚNICAMENTE el parámetro conflictivo, nunca la connection string completa.
const CONNECTION_STRING_SSL_OVERRIDE_PARAMS = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);

export function assertNoConnectionStringSslOverrides(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DbConnectionError("La connection string no es una URL válida (no se pudo interpretar para revisar parámetros SSL).");
  }

  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (CONNECTION_STRING_SSL_OVERRIDE_PARAMS.has(normalized)) {
      throw new DbConnectionError(
        `La connection string incluye el parámetro "${normalized}", que node-postgres usa para reemplazar el objeto ssl ` +
        "explícito del Pool - el modo TLS de NEXUS V3 se controla exclusivamente vía DATABASE_SSL_MODE/DATABASE_SSL_CA_B64. " +
        "Quitar ese parámetro de la connection string a mano (nunca se elimina ni se modifica automáticamente)."
      );
    }
  }
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
  let sslCa: string | undefined;

  try {
    connectionString = resolveConnectionString();
    assertNoConnectionStringSslOverrides(connectionString);
    hostname = extractHostname(connectionString);
    sslMode = resolveSslMode(hostname, process.env.DATABASE_SSL_MODE);
    sslCa = resolveSslCa(sslMode, process.env.DATABASE_SSL_CA_B64);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`After-hours DB connection failed\nreason=${errorReason(error)}`);
    }
    throw error;
  }

  currentDiagnostics = describeConnectionForLogging(connectionString, sslMode);

  const pool = new Pool({
    connectionString,
    ssl: buildSslConfig(sslMode, sslCa),
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

// Phase 5 - detalle maestro de reporte FieldBeat: medido con EXPLAIN
// (ANALYZE, BUFFERS) contra localhost:55480/nexus_bi_dev_local_test, la
// consulta de detalle (varias correlated subqueries LATERAL para
// tickets/repuestos/inconsistencias sobre 1 sola fila) tardaba 1.7-2.4s
// pese a que CADA nodo del plan ejecuta en microsegundos - el planner
// estima estas subqueries en el peor caso (miles de filas, nunca sabe que
// solo hay 1 fila externa) y ese estimado de costo dispara compilación JIT
// completa (jit_above_cost, default de Postgres), cuyo COMPILAR cuesta
// ~1.7s para un beneficio de ejecución real de <1ms. Confirmado con
// `SET jit = off`: la MISMA consulta baja a ~17ms. JIT SÍ beneficia a
// consultas agregadas grandes (overview/quality, cientos-miles de filas) -
// por eso esto es una función aparte, no un cambio a runQuery()/al pool
// completo, que seguiría penalizando esas consultas si JIT se apagara
// globalmente.
//
// BEGIN + SET LOCAL + COMMIT, nunca SET a nivel de sesión (bug real
// encontrado en code review): esta app conecta en producción vía
// Supavisor/PgBouncer en modo transaction (ver comentario al inicio de
// este archivo) - en ese modo, un client lógico de pg.Pool NO garantiza
// hablar con el mismo backend físico entre dos statements autocommited
// separados ("SET jit=off", la query real, "SET jit=on" podrían caer en 3
// backends distintos: el fix no aplicaría, y peor, "jit=off" podría
// quedar pegado en un backend que después atiende una query de
// overview/quality de OTRO request, degradándola en silencio). SET LOCAL
// dentro de una única transacción explícita sí queda garantizado al mismo
// backend durante toda esa transacción incluso bajo pooling transaction-mode,
// y se revierte solo al COMMIT/ROLLBACK - sin necesidad de un "restore"
// manual que además podría fallar/omitirse.
export async function runQueryWithoutJit<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL jit = off");
    const result = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("ECONNREFUSED") || message.includes("timeout") || message.includes("terminated")) {
      logConnectionFailure(errorReason(error));
      throw new DbConnectionError(`No se pudo conectar a Supabase Postgres: ${message}`);
    }

    throw error;
  } finally {
    client.release();
  }
}
