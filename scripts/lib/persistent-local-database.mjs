import pg from "pg";

export const PERSISTENT_LOCAL_DATABASE = Object.freeze({
  container: "nexus_bi_dev_local",
  database: "nexus_bi_dev_local",
  volume: "nexus_bi_dev_local_data",
  host: "127.0.0.1",
  port: 55480,
  user: "postgres",
  marker: "NEXUS_PERSISTENT_DEVELOPMENT:v1"
});

export function persistentLocalDatabaseUrl(environment = process.env) {
  const password = environment.NEXUS_LOCAL_DB_PASSWORD ?? "localtest";
  const url = new URL("postgresql://127.0.0.1");
  url.username = PERSISTENT_LOCAL_DATABASE.user;
  url.password = password;
  url.port = String(PERSISTENT_LOCAL_DATABASE.port);
  url.pathname = `/${PERSISTENT_LOCAL_DATABASE.database}`;
  return url.toString();
}

export function retargetPersistentLocalDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error("Una conexion local de gobierno no puede redirigirse desde un host remoto.");
  }
  url.hostname = PERSISTENT_LOCAL_DATABASE.host;
  url.port = String(PERSISTENT_LOCAL_DATABASE.port);
  url.pathname = `/${PERSISTENT_LOCAL_DATABASE.database}`;
  return url.toString();
}

export async function assertPersistentLocalDatabase(connectionString = persistentLocalDatabaseUrl()) {
  const target = new URL(connectionString);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)
      || Number(target.port) !== PERSISTENT_LOCAL_DATABASE.port
      || target.pathname.slice(1) !== PERSISTENT_LOCAL_DATABASE.database) {
    throw new Error("La base analitica no coincide con el destino persistente canonico de Nexus.");
  }

  const pool = new pg.Pool({ connectionString, application_name: "nexus-persistent-local-preflight" });
  try {
    const result = await pool.query(
      `SELECT current_database() AS database,
              inet_server_port() AS server_port,
              shobj_description(oid, 'pg_database') AS marker
       FROM pg_database
       WHERE datname = current_database()`
    );
    const row = result.rows[0];
    if (row?.database !== PERSISTENT_LOCAL_DATABASE.database
        || row?.marker !== PERSISTENT_LOCAL_DATABASE.marker) {
      throw new Error(`El destino local no esta marcado como desarrollo persistente: database=${row?.database ?? "UNKNOWN"}.`);
    }
    return row;
  } finally {
    await pool.end();
  }
}
